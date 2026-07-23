import type { Seat } from "@card-game/guandan-core";

export interface RoomEnv {
  readonly AUTHORITY_GAME: DurableObjectNamespace;
  readonly ROOM_INVITE_HASH_KEY?: string;
}

const SEATS: readonly Seat[] = ["south", "east", "north", "west"];
const DISPLAY_NAMES = new Set([
  "曹操",
  "刘备",
  "孙权",
  "周瑜",
  "诸葛亮",
  "关羽",
  "张飞",
  "赵云",
  "貂蝉",
  "小乔",
  "甄宓",
]);

interface MetaRow extends Record<string, SqlStorageValue> {
  readonly roomId: string;
  readonly ownerId: string;
  readonly inviteHash: string;
  readonly phase: "lobby" | "started";
}

interface SeatRow extends Record<string, SqlStorageValue> {
  readonly seat: Seat;
  readonly subjectId: string | null;
  readonly displayName: string | null;
  readonly displayNameKey: string | null;
  readonly ready: number;
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store",
    },
  });
}

function bytesToBase64Url(bytes: Uint8Array): string {
  let raw = "";
  for (const byte of bytes) raw += String.fromCharCode(byte);
  return btoa(raw)
    .replaceAll("+", "-")
    .replaceAll("/", "_")
    .replace(/=+$/u, "");
}

function base64UrlToBytes(value: string): Uint8Array {
  const padded =
    value.replaceAll("-", "+").replaceAll("_", "/") +
    "=".repeat((4 - (value.length % 4)) % 4);
  return Uint8Array.from(atob(padded), (char) => char.charCodeAt(0));
}

function createRoomId(): string {
  return bytesToBase64Url(crypto.getRandomValues(new Uint8Array(16)));
}

function createInviteCode(): string {
  return bytesToBase64Url(crypto.getRandomValues(new Uint8Array(16)));
}

function normalizeDisplayName(
  value: unknown,
): { readonly displayName: string; readonly key: string } | undefined {
  if (typeof value !== "string") return undefined;
  const displayName = value.normalize("NFKC").trim().replace(/\s+/gu, " ");
  const codePoints = Array.from(displayName);
  if (
    codePoints.length < 2 ||
    codePoints.length > 16 ||
    /[\p{Cc}\p{Cf}\p{M}<>&]/u.test(displayName) ||
    !/^[\p{L}\p{N}]+(?: [\p{L}\p{N}]+)*$/u.test(displayName)
  )
    return undefined;
  return { displayName, key: displayName.toLocaleLowerCase("und") };
}

async function inviteHash(code: string, env: RoomEnv): Promise<string> {
  const encoded = env.ROOM_INVITE_HASH_KEY;
  if (!encoded || !/^[A-Za-z0-9_-]{43}$/u.test(encoded))
    throw new Error("invite_key_unavailable");
  const key = await crypto.subtle.importKey(
    "raw",
    base64UrlToBytes(encoded).buffer as ArrayBuffer,
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  return bytesToBase64Url(
    new Uint8Array(
      await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(code)),
    ),
  );
}

function isSeat(value: unknown): value is Seat {
  return typeof value === "string" && SEATS.includes(value as Seat);
}

/** P3-05 lobby state only. Gameplay/WebSocket ownership stays with later tasks. */
export class RoomDurableObject {
  constructor(
    private readonly ctx: DurableObjectState,
    private readonly env: RoomEnv,
  ) {}

  private setup(): void {
    this.ctx.storage.sql.exec(
      "CREATE TABLE IF NOT EXISTS room_meta (id INTEGER PRIMARY KEY CHECK(id=1), room_id TEXT NOT NULL, owner_id TEXT NOT NULL, invite_hash TEXT NOT NULL, phase TEXT NOT NULL)",
    );
    this.ctx.storage.sql.exec(
      "CREATE TABLE IF NOT EXISTS seats (seat TEXT PRIMARY KEY, subject_id TEXT UNIQUE, display_name TEXT UNIQUE, display_name_key TEXT UNIQUE, ready INTEGER NOT NULL)",
    );
    this.ctx.storage.sql.exec(
      "CREATE TABLE IF NOT EXISTS seat_requests (subject_id TEXT PRIMARY KEY, requested_seat TEXT NOT NULL)",
    );
    this.ctx.storage.sql.exec(
      "CREATE TABLE IF NOT EXISTS room_events (sequence INTEGER PRIMARY KEY AUTOINCREMENT, payload TEXT NOT NULL)",
    );
  }

  private meta(): MetaRow | undefined {
    return [
      ...this.ctx.storage.sql.exec<MetaRow>(
        "SELECT room_id as roomId, owner_id as ownerId, invite_hash as inviteHash, phase FROM room_meta WHERE id=1",
      ),
    ][0];
  }

  private seats(): readonly SeatRow[] {
    const rows = [
      ...this.ctx.storage.sql.exec<SeatRow>(
        "SELECT seat, subject_id as subjectId, display_name as displayName, display_name_key as displayNameKey, ready FROM seats",
      ),
    ];
    return SEATS.map((seat) => rows.find((row) => row.seat === seat)!).filter(
      Boolean,
    );
  }

  private append(event: Record<string, unknown>): void {
    this.ctx.storage.sql.exec(
      "INSERT INTO room_events (payload) VALUES (?)",
      JSON.stringify(event),
    );
  }

  private projection(meta: MetaRow): Record<string, unknown> {
    return {
      roomId: meta.roomId,
      phase: meta.phase,
      seats: this.seats().map((row) =>
        row.subjectId
          ? {
              seat: row.seat,
              controller: "human",
              displayName: row.displayName,
              ready: row.ready === 1,
              isHost: row.subjectId === meta.ownerId,
            }
          : {
              seat: row.seat,
              controller: "bot",
              strategy: "normal-vNext",
              ready: true,
            },
      ),
    };
  }

  private subjectSeat(subjectId: string): SeatRow | undefined {
    return this.seats().find((row) => row.subjectId === subjectId);
  }

  private async startAuthority(meta: MetaRow, now: number): Promise<boolean> {
    const stub = this.env.AUTHORITY_GAME.get(
      this.env.AUTHORITY_GAME.idFromName(meta.roomId),
    );
    const response = await stub.fetch("https://authority.internal/initialize", {
      method: "POST",
      body: JSON.stringify({
        ownerId: `room:${meta.roomId}`,
        subjectId: `room:${meta.roomId}`,
        now,
      }),
    });
    return response.status === 201 || response.status === 409;
  }

  async fetch(request: Request): Promise<Response> {
    this.setup();
    const path = new URL(request.url).pathname;
    let payload: Record<string, unknown>;
    try {
      payload = (await request.json()) as Record<string, unknown>;
    } catch {
      return json({ error: "invalid_payload" }, 400);
    }
    const subjectId = payload.subjectId;
    if (typeof subjectId !== "string")
      return json({ error: "unauthorized" }, 401);

    if (path === "/create") {
      if (this.meta()) return json({ error: "already_created" }, 409);
      const name = normalizeDisplayName(payload.displayName);
      if (!name) return json({ error: "invalid_display_name" }, 422);
      if (payload.seat !== undefined && !isSeat(payload.seat))
        return json({ error: "invalid_seat" }, 422);
      const roomId =
        typeof payload.roomId === "string" &&
        /^[A-Za-z0-9_-]{22}$/u.test(payload.roomId)
          ? payload.roomId
          : createRoomId();
      const code = createInviteCode();
      let codeHash: string;
      try {
        codeHash = await inviteHash(code, this.env);
      } catch {
        return json({ error: "room_unavailable" }, 503);
      }
      const seat = (payload.seat as Seat | undefined) ?? "south";
      this.ctx.storage.transactionSync(() => {
        this.ctx.storage.sql.exec(
          "INSERT INTO room_meta (id, room_id, owner_id, invite_hash, phase) VALUES (1, ?, ?, ?, 'lobby')",
          roomId,
          subjectId,
          codeHash,
        );
        for (const current of SEATS) {
          this.ctx.storage.sql.exec(
            "INSERT INTO seats (seat, subject_id, display_name, display_name_key, ready) VALUES (?, ?, ?, ?, 0)",
            current,
            current === seat ? subjectId : null,
            current === seat ? name.displayName : null,
            current === seat ? name.key : null,
          );
        }
        this.append({ type: "room.created", subjectId, seat });
      });
      return json(
        { roomId, inviteCode: code, room: this.projection(this.meta()!) },
        201,
      );
    }

    const meta = this.meta();
    if (!meta) return json({ error: "room_not_found" }, 404);
    if (path === "/view") {
      if (!this.subjectSeat(subjectId))
        return json({ error: "not_in_room" }, 403);
      return json({ room: this.projection(meta) });
    }
    if (meta.phase === "started")
      return json({ error: "room_already_started" }, 409);

    if (path === "/join") {
      if (this.subjectSeat(subjectId))
        return json({ error: "already_joined" }, 409);
      const name = normalizeDisplayName(payload.displayName);
      if (!name || typeof payload.inviteCode !== "string")
        return json({ error: "invalid_payload" }, 422);
      let suppliedHash: string;
      try {
        suppliedHash = await inviteHash(payload.inviteCode, this.env);
      } catch {
        return json({ error: "room_unavailable" }, 503);
      }
      if (suppliedHash !== meta.inviteHash)
        return json({ error: "invalid_invite" }, 403);
      const seats = this.seats();
      const desired = payload.seat === undefined ? undefined : payload.seat;
      if (desired !== undefined && !isSeat(desired))
        return json({ error: "invalid_seat" }, 422);
      const target = desired ?? seats.find((seat) => !seat.subjectId)?.seat;
      if (!target) return json({ error: "room_full" }, 409);
      const row = seats.find((seat) => seat.seat === target)!;
      if (row.subjectId) return json({ error: "seat_unavailable" }, 409);
      try {
        this.ctx.storage.transactionSync(() => {
          this.ctx.storage.sql.exec(
            "UPDATE seats SET subject_id=?, display_name=?, display_name_key=?, ready=0 WHERE seat=?",
            subjectId,
            name.displayName,
            name.key,
            target,
          );
          this.append({ type: "room.joined", subjectId, seat: target });
        });
      } catch {
        return json({ error: "display_name_in_use" }, 409);
      }
      return json({ room: this.projection(meta) });
    }

    const ownSeat = this.subjectSeat(subjectId);
    if (!ownSeat) return json({ error: "not_in_room" }, 403);
    if (path === "/ready") {
      this.ctx.storage.transactionSync(() => {
        this.ctx.storage.sql.exec(
          "UPDATE seats SET ready=1 WHERE seat=?",
          ownSeat.seat,
        );
        this.append({ type: "room.ready", subjectId, seat: ownSeat.seat });
      });
      return json({ room: this.projection(meta) });
    }
    if (path === "/seat-request") {
      if (!isSeat(payload.seat)) return json({ error: "invalid_seat" }, 422);
      const target = this.seats().find((row) => row.seat === payload.seat)!;
      if (target.subjectId) return json({ error: "seat_unavailable" }, 409);
      this.ctx.storage.transactionSync(() => {
        this.ctx.storage.sql.exec(
          "INSERT OR REPLACE INTO seat_requests (subject_id, requested_seat) VALUES (?, ?)",
          subjectId,
          payload.seat,
        );
        this.append({
          type: "room.seat_requested",
          subjectId,
          seat: payload.seat,
        });
      });
      return json({ room: this.projection(meta) }, 202);
    }
    if (path === "/approve-seat-request") {
      if (subjectId !== meta.ownerId) return json({ error: "forbidden" }, 403);
      if (typeof payload.requestSubjectId !== "string")
        return json({ error: "invalid_payload" }, 422);
      const request = [
        ...this.ctx.storage.sql.exec<{ requestedSeat: Seat }>(
          "SELECT requested_seat as requestedSeat FROM seat_requests WHERE subject_id=?",
          payload.requestSubjectId,
        ),
      ][0];
      const mover = this.subjectSeat(payload.requestSubjectId);
      const target =
        request &&
        this.seats().find((row) => row.seat === request.requestedSeat);
      if (!request || !mover || !target || target.subjectId)
        return json({ error: "seat_request_unavailable" }, 409);
      this.ctx.storage.transactionSync(() => {
        this.ctx.storage.sql.exec(
          "UPDATE seats SET subject_id=NULL, display_name=NULL, display_name_key=NULL, ready=0 WHERE seat=?",
          mover.seat,
        );
        this.ctx.storage.sql.exec(
          "UPDATE seats SET subject_id=?, display_name=?, display_name_key=?, ready=0 WHERE seat=?",
          mover.subjectId,
          mover.displayName,
          mover.displayNameKey,
          request.requestedSeat,
        );
        this.ctx.storage.sql.exec(
          "DELETE FROM seat_requests WHERE subject_id=?",
          payload.requestSubjectId,
        );
        this.append({
          type: "room.seat_approved",
          subjectId: payload.requestSubjectId,
          seat: request.requestedSeat,
        });
      });
      return json({ room: this.projection(meta) });
    }
    if (path === "/start") {
      if (subjectId !== meta.ownerId) return json({ error: "forbidden" }, 403);
      if (this.seats().some((seat) => seat.subjectId && seat.ready !== 1))
        return json({ error: "players_not_ready" }, 422);
      if (!(await this.startAuthority(meta, Number(payload.now))))
        return json({ error: "authority_unavailable" }, 503);
      this.ctx.storage.transactionSync(() => {
        this.ctx.storage.sql.exec(
          "UPDATE room_meta SET phase='started' WHERE id=1",
        );
        this.append({ type: "room.started", subjectId });
      });
      return json({ room: this.projection(this.meta()!) });
    }
    return json({ error: "not_found" }, 404);
  }
}
