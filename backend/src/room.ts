import { botThinkDelayMs, type Seat } from "@card-game/guandan-core";

export interface RoomEnv {
  readonly AUTHORITY_GAME: DurableObjectNamespace;
  readonly REALTIME_ROOM: DurableObjectNamespace;
  readonly ROOM_INVITE_HASH_KEY?: string;
  readonly P3_TEST_MODE?: string;
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

interface PresenceRow extends Record<string, SqlStorageValue> {
  readonly subjectId: string;
  readonly connected: number;
  readonly connectedAt: number;
  readonly lastSeenAt: number;
  readonly disconnectedAt: number | null;
}

interface TakeoverRow extends Record<string, SqlStorageValue> {
  readonly seat: Seat;
  readonly enabled: number;
  readonly recoverPending: number;
}

interface TurnStatus {
  readonly gameId: string;
  readonly current: Seat;
  readonly eventSequence: number;
  readonly turnStartedAt: number;
  readonly botControlled: boolean;
  readonly completed: boolean;
}

interface BotTaskRow extends Record<string, SqlStorageValue> {
  readonly gameId: string;
  readonly turnGeneration: string;
  readonly seat: Seat;
  readonly scheduledAt: number;
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
    this.ctx.storage.sql.exec(
      "CREATE TABLE IF NOT EXISTS presence (subject_id TEXT PRIMARY KEY, connected INTEGER NOT NULL, connected_at INTEGER NOT NULL, last_seen_at INTEGER NOT NULL, disconnected_at INTEGER)",
    );
    this.ctx.storage.sql.exec(
      "CREATE TABLE IF NOT EXISTS seat_takeovers (seat TEXT PRIMARY KEY, enabled INTEGER NOT NULL, recover_pending INTEGER NOT NULL)",
    );
    this.ctx.storage.sql.exec(
      "CREATE TABLE IF NOT EXISTS bot_tasks (id INTEGER PRIMARY KEY CHECK(id=1), game_id TEXT NOT NULL, turn_generation TEXT NOT NULL, seat TEXT NOT NULL, scheduled_at INTEGER NOT NULL)",
    );
    this.ctx.storage.sql.exec(
      "CREATE TABLE IF NOT EXISTS diagnostic_events (sequence INTEGER PRIMARY KEY AUTOINCREMENT, payload TEXT NOT NULL)",
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
  /** Test-only, local diagnostic trail. It is never reachable in production. */
  private diagnostic(
    meta: MetaRow,
    event: string,
    details: Record<string, unknown>,
  ): void {
    if (this.env.P3_TEST_MODE !== "true") return;
    this.ctx.storage.sql.exec(
      "INSERT INTO diagnostic_events (payload) VALUES (?)",
      JSON.stringify({ roomId: meta.roomId, event, ...details }),
    );
  }
  private diagnosticTurnGeneration(status: TurnStatus): string {
    return `${status.gameId}:${status.eventSequence}:${status.current}`;
  }

  /** Broadcasts only a public invalidation signal; each socket reloads its own projection. */
  private async notifyRealtime(roomId: string): Promise<void> {
    const realtime = this.env.REALTIME_ROOM.get(
      this.env.REALTIME_ROOM.idFromName(roomId),
    );
    await realtime.fetch("https://realtime.internal/room-changed", {
      method: "POST",
      headers: { "x-p3-internal-room-id": roomId },
    });
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
  private presence(subjectId: string): PresenceRow | undefined {
    return [
      ...this.ctx.storage.sql.exec<PresenceRow>(
        "SELECT subject_id as subjectId, connected, connected_at as connectedAt, last_seen_at as lastSeenAt, disconnected_at as disconnectedAt FROM presence WHERE subject_id=?",
        subjectId,
      ),
    ][0];
  }
  private takeover(seat: Seat): TakeoverRow | undefined {
    return [
      ...this.ctx.storage.sql.exec<TakeoverRow>(
        "SELECT seat, enabled, recover_pending as recoverPending FROM seat_takeovers WHERE seat=?",
        seat,
      ),
    ][0];
  }
  private botTask(): BotTaskRow | undefined {
    return [
      ...this.ctx.storage.sql.exec<BotTaskRow>(
        "SELECT game_id as gameId, turn_generation as turnGeneration, seat, scheduled_at as scheduledAt FROM bot_tasks WHERE id=1",
      ),
    ][0];
  }
  private scheduleBotTask(status: TurnStatus, scheduledAt: number): BotTaskRow {
    const turnGeneration = this.diagnosticTurnGeneration(status);
    this.ctx.storage.sql.exec(
      "INSERT INTO bot_tasks (id, game_id, turn_generation, seat, scheduled_at) VALUES (1, ?, ?, ?, ?) ON CONFLICT(id) DO UPDATE SET game_id=excluded.game_id, turn_generation=excluded.turn_generation, seat=excluded.seat, scheduled_at=excluded.scheduled_at",
      status.gameId,
      turnGeneration,
      status.current,
      scheduledAt,
    );
    return {
      gameId: status.gameId,
      turnGeneration,
      seat: status.current,
      scheduledAt,
    };
  }
  private clearBotTask(): void {
    this.ctx.storage.sql.exec("DELETE FROM bot_tasks");
  }
  private authority(meta: MetaRow): DurableObjectStub {
    return this.env.AUTHORITY_GAME.get(
      this.env.AUTHORITY_GAME.idFromName(meta.roomId),
    );
  }
  private async authorityPost(
    meta: MetaRow,
    path: string,
    body: Record<string, unknown>,
  ): Promise<Response> {
    return this.authority(meta).fetch(`https://authority.internal/${path}`, {
      method: "POST",
      body: JSON.stringify({
        subjectId: `room:${meta.roomId}`,
        now: body.now,
        ...body,
      }),
    });
  }
  private async setBotControl(
    meta: MetaRow,
    seat: Seat,
    enabled: boolean,
    now: number,
  ): Promise<void> {
    const response = await this.authorityPost(meta, "bot-control", {
      seat,
      enabled,
      now,
    });
    if (!response.ok) throw new Error("authority_unavailable");
    this.ctx.storage.sql.exec(
      "INSERT INTO seat_takeovers (seat, enabled, recover_pending) VALUES (?, ?, 0) ON CONFLICT(seat) DO UPDATE SET enabled=excluded.enabled, recover_pending=0",
      seat,
      enabled ? 1 : 0,
    );
    this.diagnostic(meta, "takeover.changed", {
      logicalSeat: seat,
      controllerMode: enabled ? "bot" : "human",
      takeoverEnabled: enabled,
      at: now,
    });
  }
  private async scheduleReconcile(
    meta: MetaRow,
    now: number,
    status?: TurnStatus,
  ): Promise<void> {
    // Alarms are the authoritative clock for missed heartbeats, bot tasks, and
    // lobby retention. Requests merely bring the same reconciliation forward.
    // Deterministic local fixtures advance `now` explicitly; real timers would
    // make those tests wait for wall-clock deadlines rather than exercising the
    // persisted deadline calculation.
    if (this.env.P3_TEST_MODE === "true") return;
    const candidates: number[] = [];
    for (const presence of [
      ...this.ctx.storage.sql.exec<PresenceRow>(
        "SELECT subject_id as subjectId, connected, connected_at as connectedAt, last_seen_at as lastSeenAt, disconnected_at as disconnectedAt FROM presence",
      ),
    ]) {
      if (presence.connected === 1)
        candidates.push(presence.lastSeenAt + 30_000);
    }
    if (meta.phase === "lobby") {
      const ownerPresence = this.presence(meta.ownerId);
      if (ownerPresence?.connected === 0) {
        const disconnectedAt = ownerPresence.disconnectedAt ?? now;
        candidates.push(disconnectedAt + 60_000, disconnectedAt + 300_000);
      }
    } else {
      const task = this.botTask();
      if (
        (status === undefined ||
          (task?.gameId === status.gameId &&
            task.turnGeneration === this.diagnosticTurnGeneration(status))) &&
        task
      )
        // A local runtime may have cancelled a previously persisted alarm.
        // Never let an overdue, still-current bot task fall through to the
        // human heartbeat.  Keep a bounded retry delay so a transient
        // Authority failure cannot create a zero-delay alarm spin loop.
        candidates.push(Math.max(task.scheduledAt, now + 1_000));
      const current = status
        ? this.seats().find((seat) => seat.seat === status.current)
        : undefined;
      const presence = current?.subjectId
        ? this.presence(current.subjectId)
        : undefined;
      if (presence?.connected === 0)
        candidates.push((presence.disconnectedAt ?? now) + 10_000);
    }
    const next = candidates
      .filter((time) => time > now)
      .sort((a, b) => a - b)[0];
    // DurableObjectStorage.setAlarm() persists asynchronously.  Do not leave
    // that promise detached: Miniflare can cancel a detached alarm when the
    // request finishes, stranding an already-recorded bot task until a later
    // unrelated request happens to reconcile the room.
    if (next !== undefined) await this.ctx.storage.setAlarm(next);
  }
  private markMissedHeartbeats(now: number): void {
    for (const presence of [
      ...this.ctx.storage.sql.exec<PresenceRow>(
        "SELECT subject_id as subjectId, connected, connected_at as connectedAt, last_seen_at as lastSeenAt, disconnected_at as disconnectedAt FROM presence WHERE connected=1",
      ),
    ]) {
      if (now - presence.lastSeenAt < 30_000) continue;
      this.ctx.storage.sql.exec(
        "UPDATE presence SET connected=0, disconnected_at=? WHERE subject_id=?",
        presence.lastSeenAt + 30_000,
        presence.subjectId,
      );
    }
  }
  private async reconcile(meta: MetaRow, now: number): Promise<void> {
    this.markMissedHeartbeats(now);
    if (meta.phase === "lobby") {
      const ownerPresence = this.presence(meta.ownerId);
      if (ownerPresence?.connected === 0) {
        const disconnectedFor = now - (ownerPresence.disconnectedAt ?? now);
        const candidates = this.seats()
          .filter((seat) => seat.subjectId && seat.subjectId !== meta.ownerId)
          .map((seat) => ({ seat, presence: this.presence(seat.subjectId!) }))
          .filter(
            (item): item is { seat: SeatRow; presence: PresenceRow } =>
              item.presence?.connected === 1,
          )
          .sort(
            (left, right) =>
              left.presence.connectedAt - right.presence.connectedAt,
          );
        if (disconnectedFor >= 60_000 && candidates[0]) {
          this.ctx.storage.transactionSync(() => {
            this.ctx.storage.sql.exec(
              "UPDATE room_meta SET owner_id=? WHERE id=1",
              candidates[0].seat.subjectId,
            );
            this.append({
              type: "room.host_transferred",
              seat: candidates[0].seat.seat,
            });
          });
        } else if (disconnectedFor >= 300_000 && candidates.length === 0) {
          this.ctx.storage.transactionSync(() => {
            this.ctx.storage.sql.exec("DELETE FROM seat_requests");
            this.ctx.storage.sql.exec("DELETE FROM presence");
            this.ctx.storage.sql.exec("DELETE FROM seat_takeovers");
            this.ctx.storage.sql.exec("DELETE FROM seats");
            this.ctx.storage.sql.exec("DELETE FROM room_events");
            this.ctx.storage.sql.exec("DELETE FROM room_meta");
          });
        }
      }
      await this.scheduleReconcile(meta, now);
      return;
    }
    const statusResponse = await this.authorityPost(meta, "turn-status", {
      now,
    });
    if (!statusResponse.ok) throw new Error("authority_unavailable");
    let status = (await statusResponse.json()) as TurnStatus;
    if (status.completed) {
      // The Authority owns the full completed session and has the only secure
      // next-round entry point. Keep the room and its identities alive, then
      // re-enter reconciliation for the newly dealt authority game.
      this.clearBotTask();
      const commandId = `next-round-${status.gameId}-${status.eventSequence}`;
      const nextRound = await this.authorityPost(meta, "next-round", {
        commandId,
        now,
      });
      this.diagnostic(meta, "round.next", {
        gameId: status.gameId,
        commandId,
        expectedEventSequence: status.eventSequence,
        acknowledgementStatus: nextRound.status,
        at: now,
      });
      if (!nextRound.ok) throw new Error("next_round_unavailable");
      await this.reconcile(meta, now);
      return;
    }
    const currentSeat = this.seats().find(
      (seat) => seat.seat === status.current,
    )!;
    this.diagnostic(meta, "reconcile.enter", {
      gameId: status.gameId,
      turnGeneration: this.diagnosticTurnGeneration(status),
      currentActorSeat: status.current,
      controllerMode: status.botControlled ? "bot" : "human",
      controllerSubjectId: currentSeat.subjectId,
      authorityEventSequence: status.eventSequence,
      takeoverDeadline: status.turnStartedAt + 30_000,
      at: now,
    });
    for (const seat of this.seats()) {
      if (!seat.subjectId) {
        if (!this.takeover(seat.seat)?.enabled)
          await this.setBotControl(meta, seat.seat, true, now);
        continue;
      }
      const presence = this.presence(seat.subjectId);
      // A seated human that has not opened a realtime connection is not yet a
      // disconnect. Otherwise a just-started room would incorrectly hand every
      // non-host seat to a bot before its first heartbeat.
      const disconnected = presence?.connected === 0;
      const elapsed = now - (presence?.disconnectedAt ?? now);
      const disconnectDue =
        disconnected && (status.current !== seat.seat || elapsed >= 10_000);
      if (disconnectDue && !this.takeover(seat.seat)?.enabled)
        await this.setBotControl(meta, seat.seat, true, now);
    }
    // A recovered human takes future actions at this boundary.  The only
    // exception is the current bot action, which is finished before control is
    // returned (the loop below executes it through Authority).
    for (const seat of this.seats()) {
      if (
        seat.seat !== status.current &&
        seat.subjectId &&
        this.presence(seat.subjectId)?.connected === 1 &&
        this.takeover(seat.seat)?.enabled
      )
        await this.setBotControl(meta, seat.seat, false, now);
    }
    // A durable task is scoped to exactly one authority turn.  A reconciliation
    // can execute at most that task; it must never chain several bot seats in a
    // single request.  The next authority event creates the next task.
    const turnGeneration = this.diagnosticTurnGeneration(status);
    const currentTakeover = this.takeover(status.current);
    if (!currentTakeover?.enabled) {
      this.clearBotTask();
      await this.scheduleReconcile(meta, now, status);
      return;
    }
    let task = this.botTask();
    if (
      task?.gameId !== status.gameId ||
      task?.turnGeneration !== turnGeneration ||
      task?.seat !== status.current
    ) {
      if (task) {
        this.diagnostic(meta, "bot.dispatch.stale", {
          gameId: task.gameId,
          turnGeneration: task.turnGeneration,
          currentActorSeat: task.seat,
          scheduledAt: task.scheduledAt,
          at: now,
        });
        this.clearBotTask();
      }
      task = this.scheduleBotTask(
        status,
        now + botThinkDelayMs(status.eventSequence),
      );
      this.diagnostic(meta, "bot.dispatch.scheduled", {
        gameId: status.gameId,
        turnGeneration,
        currentActorSeat: status.current,
        authorityEventSequence: status.eventSequence,
        scheduledAt: task.scheduledAt,
        at: now,
      });
    }
    if (now < task.scheduledAt) {
      await this.scheduleReconcile(meta, now, status);
      return;
    }
    const botSeat = this.seats().find((seat) => seat.seat === status.current)!;
    const currentPresence = botSeat.subjectId
      ? this.presence(botSeat.subjectId)
      : undefined;
    const commandId = `bot-${status.current}-${status.eventSequence + 1}`;
    const command = await this.authorityPost(meta, "bot-command", {
      commandId,
      now,
    });
    const acknowledgement = command.ok
      ? ((await command.clone().json()) as {
          readonly decisionDurationMs?: unknown;
        })
      : undefined;
    this.diagnostic(meta, "bot.dispatch.executed", {
      gameId: status.gameId,
      turnGeneration,
      currentActorSeat: status.current,
      controllerMode: "bot",
      controllerSubjectId: botSeat.subjectId,
      commandId,
      expectedEventSequence: status.eventSequence,
      scheduledAt: task.scheduledAt,
      executedAt: now,
      acknowledgementStatus: command.status,
      ...(typeof acknowledgement?.decisionDurationMs === "number"
        ? { decisionDurationMs: acknowledgement.decisionDurationMs }
        : {}),
    });
    if (!command.ok) throw new Error("bot_command_unavailable");
    this.clearBotTask();
    status = (await (
      await this.authorityPost(meta, "turn-status", { now })
    ).json()) as TurnStatus;
    // A bot can finish the round.  This is still an Authority action boundary,
    // so take the same completed-round path as a human action instead of
    // scheduling an inert reconciliation against the completed game.
    if (status.completed) {
      await this.reconcile(meta, now);
      return;
    }
    if (!status.completed && currentPresence?.connected === 1)
      await this.setBotControl(meta, botSeat.seat, false, now);
    if (!status.completed && this.takeover(status.current)?.enabled) {
      const nextTask = this.scheduleBotTask(
        status,
        now + botThinkDelayMs(status.eventSequence),
      );
      this.diagnostic(meta, "bot.dispatch.scheduled", {
        gameId: status.gameId,
        turnGeneration: this.diagnosticTurnGeneration(status),
        currentActorSeat: status.current,
        authorityEventSequence: status.eventSequence,
        scheduledAt: nextTask.scheduledAt,
        at: now,
      });
    }
    await this.scheduleReconcile(meta, now, status);
  }
  private markPresence(
    subjectId: string,
    connected: boolean,
    now: number,
  ): void {
    const existing = this.presence(subjectId);
    if (connected)
      this.ctx.storage.sql.exec(
        "INSERT INTO presence (subject_id, connected, connected_at, last_seen_at, disconnected_at) VALUES (?, 1, ?, ?, NULL) ON CONFLICT(subject_id) DO UPDATE SET connected=1, connected_at=CASE WHEN presence.connected=1 THEN presence.connected_at ELSE excluded.connected_at END, last_seen_at=excluded.last_seen_at, disconnected_at=NULL",
        subjectId,
        now,
        now,
      );
    else if (existing?.connected === 1)
      this.ctx.storage.sql.exec(
        "UPDATE presence SET connected=0, last_seen_at=?, disconnected_at=? WHERE subject_id=?",
        now,
        now,
        subjectId,
      );
  }

  async alarm(): Promise<void> {
    this.setup();
    const meta = this.meta();
    if (!meta) return;
    try {
      await this.reconcile(meta, Date.now());
      await this.notifyRealtime(meta.roomId).catch(() => undefined);
    } catch (error) {
      // Preserve the persisted bot-task deadline on a transient Authority
      // failure.  Calling scheduleReconcile without this task used to replace
      // the short bot alarm with the 30-second human heartbeat.
      console.warn(
        JSON.stringify({
          event: "room_alarm_reconcile_retry",
          hasBotTask: Boolean(this.botTask()),
          reason: error instanceof Error ? error.message : "unknown_error",
        }),
      );
      // The next scheduled reconciliation retries transient Authority failures.
      await this.scheduleReconcile(meta, Date.now());
    }
  }

  private async startAuthority(
    meta: MetaRow,
    now: number,
    testInitialLeader?: Seat,
  ): Promise<boolean> {
    const controllers = Object.fromEntries(
      this.seats()
        .filter((seat): seat is SeatRow & { readonly subjectId: string } =>
          Boolean(seat.subjectId),
        )
        .map((seat) => [seat.seat, seat.subjectId]),
    );
    const initialLeader =
      this.env.P3_TEST_MODE === "true"
        ? (testInitialLeader ?? "east")
        : SEATS[crypto.getRandomValues(new Uint32Array(1))[0] % SEATS.length];
    const stub = this.env.AUTHORITY_GAME.get(
      this.env.AUTHORITY_GAME.idFromName(meta.roomId),
    );
    const response = await stub.fetch("https://authority.internal/initialize", {
      method: "POST",
      body: JSON.stringify({
        ownerId: `room:${meta.roomId}`,
        subjectId: `room:${meta.roomId}`,
        controllers,
        initialLeader,
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
    if (
      meta.phase === "started" &&
      path !== "/authority-view" &&
      path !== "/authority-command" &&
      path !== "/presence" &&
      path !== "/internal-diagnostics" &&
      path !== "/internal-complete-round" &&
      path !== "/restart-match" &&
      path !== "/restart-round"
    )
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
    if (path === "/presence") {
      if (
        typeof payload.connected !== "boolean" ||
        typeof payload.now !== "number"
      )
        return json({ error: "invalid_payload" }, 422);
      this.markPresence(subjectId, payload.connected, payload.now);
      try {
        await this.reconcile(meta, payload.now);
      } catch {
        return json({ error: "authority_unavailable" }, 503);
      }
      const currentMeta = this.meta();
      if (!currentMeta) return json({ error: "room_closed" }, 410);
      return json({ room: this.projection(currentMeta) });
    }
    if (path === "/authority-view") {
      if (meta.phase !== "started")
        return json({ error: "room_not_started" }, 409);
      // A personal projection is a read.  In particular it must not turn a
      // wall-clock GET into a timeout/takeover transition: callers can read at
      // any time, while connection liveness is driven by realtime heartbeats,
      // explicit presence updates, and the Room alarm.  Advancing here also
      // made deterministic fixtures race their controlled `now` with Date.now.
      return this.authority(meta).fetch("https://authority.internal/view", {
        method: "POST",
        body: JSON.stringify({ subjectId, now: payload.now }),
      });
    }
    if (path === "/internal-diagnostics") {
      if (this.env.P3_TEST_MODE !== "true")
        return json({ error: "not_found" }, 404);
      return json({
        entries: [
          ...this.ctx.storage.sql.exec<{ sequence: number; payload: string }>(
            "SELECT sequence, payload FROM diagnostic_events ORDER BY sequence",
          ),
        ].map((row) => ({
          sequence: row.sequence,
          ...JSON.parse(row.payload),
        })),
      });
    }
    if (path === "/internal-complete-round") {
      if (this.env.P3_TEST_MODE !== "true")
        return json({ error: "not_found" }, 404);
      if (subjectId !== meta.ownerId) return json({ error: "forbidden" }, 403);
      const completed = await this.authorityPost(
        meta,
        "internal-complete-round",
        {
          now: Number(payload.now),
        },
      );
      if (!completed.ok) return completed;
      await this.reconcile(meta, Number(payload.now));
      await this.notifyRealtime(meta.roomId).catch(() => undefined);
      return json({ room: this.projection(this.meta()!) });
    }
    if (path === "/authority-command") {
      if (meta.phase !== "started")
        return json({ error: "room_not_started" }, 409);
      if (
        typeof payload.commandId !== "string" ||
        typeof payload.kind !== "string" ||
        !Number.isInteger(payload.expectedEventSequence)
      )
        return json({ error: "invalid_payload" }, 422);
      const cardIds = Array.isArray(payload.cardIds)
        ? payload.cardIds.filter(
            (cardId): cardId is string => typeof cardId === "string",
          )
        : undefined;
      if (
        Array.isArray(payload.cardIds) &&
        cardIds?.length !== payload.cardIds.length
      )
        return json({ error: "invalid_payload" }, 422);
      this.markPresence(subjectId, true, Number(payload.now));
      this.diagnostic(meta, "human.command.received", {
        commandId: payload.commandId,
        expectedEventSequence: payload.expectedEventSequence,
        submittedCardIds: cardIds ?? [],
        currentActorSeat: ownSeat.seat,
        controllerMode: "human",
        controllerSubjectId: subjectId,
        at: Number(payload.now),
      });
      try {
        await this.reconcile(meta, Number(payload.now));
      } catch {
        return json({ error: "authority_unavailable" }, 503);
      }
      const response = await this.authority(meta).fetch(
        "https://authority.internal/command",
        {
          method: "POST",
          body: JSON.stringify({
            subjectId,
            now: payload.now,
            commandId: payload.commandId,
            expectedEventSequence: payload.expectedEventSequence,
            kind: payload.kind,
            ...(cardIds ? { cardIds } : {}),
          }),
        },
      );
      if (response.ok) {
        const acknowledged = (await response.clone().json()) as {
          readonly eventSequence?: number;
        };
        this.diagnostic(meta, "human.command.acknowledged", {
          commandId: payload.commandId,
          expectedEventSequence: payload.expectedEventSequence,
          authorityEventSequence: acknowledged.eventSequence,
          acknowledgementStatus: response.status,
          at: Number(payload.now),
        });
        // The Authority event has crossed the turn boundary.  No delayed task
        // created for the former generation may survive this human action.
        this.clearBotTask();
        // Reconciliation only records the next bot task here; its scheduled
        // time is always in the future, so it cannot execute normal-vNext in
        // this human request.  Await it instead of racing a background
        // waitUntil reconciliation with a second raw setAlarm call.  That race
        // can cancel the Durable Object alarm and leave a bot turn stranded.
        if (this.env.P3_TEST_MODE !== "true") {
          try {
            await this.reconcile(meta, Number(payload.now));
          } catch {
            return json({ error: "authority_unavailable" }, 503);
          }
        }
        await this.notifyRealtime(meta.roomId).catch(() => undefined);
      } else
        this.diagnostic(meta, "human.command.rejected", {
          commandId: payload.commandId,
          expectedEventSequence: payload.expectedEventSequence,
          acknowledgementStatus: response.status,
          at: Number(payload.now),
        });
      return response;
    }
    if (path === "/restart-match" || path === "/restart-round") {
      if (meta.phase !== "started")
        return json({ error: "room_not_started" }, 409);
      if (subjectId !== meta.ownerId) return json({ error: "forbidden" }, 403);
      if (
        typeof payload.clientCommandId !== "string" ||
        !Number.isInteger(payload.expectedEventSequence)
      )
        return json({ error: "invalid_payload" }, 422);
      const initialLeader =
        path === "/restart-match"
          ? SEATS[crypto.getRandomValues(new Uint32Array(1))[0] % SEATS.length]
          : undefined;
      const response = await this.authorityPost(
        meta,
        path === "/restart-match" ? "new-game" : "restart-current-round",
        {
          commandId: payload.clientCommandId,
          expectedEventSequence: payload.expectedEventSequence,
          ...(initialLeader ? { initialLeader } : {}),
          now: payload.now,
        },
      );
      if (!response.ok) {
        this.diagnostic(meta, "restart.rejected", {
          restartKind: path,
          commandId: payload.clientCommandId,
          expectedEventSequence: payload.expectedEventSequence,
          acknowledgementStatus: response.status,
          at: Number(payload.now),
        });
        return response;
      }
      const restart = (await response.clone().json()) as {
        readonly gameId?: string;
        readonly eventSequence?: number;
      };
      this.diagnostic(meta, "restart.acknowledged", {
        restartKind: path,
        commandId: payload.clientCommandId,
        expectedEventSequence: payload.expectedEventSequence,
        gameId: restart.gameId,
        authorityEventSequence: restart.eventSequence,
        acknowledgementStatus: response.status,
        at: Number(payload.now),
      });
      // A new Authority game/round invalidates every delayed task from the
      // previous event stream before reconciliation observes the new turn.
      this.clearBotTask();
      try {
        await this.reconcile(meta, Number(payload.now));
      } catch {
        return json({ error: "authority_unavailable" }, 503);
      }
      await this.notifyRealtime(meta.roomId).catch(() => undefined);
      return json({ room: this.projection(this.meta()!) });
    }
    if (path === "/ready") {
      this.ctx.storage.transactionSync(() => {
        this.ctx.storage.sql.exec(
          "UPDATE seats SET ready=1 WHERE seat=?",
          ownSeat.seat,
        );
        this.append({ type: "room.ready", subjectId, seat: ownSeat.seat });
      });
      await this.notifyRealtime(meta.roomId).catch(() => undefined);
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
      const testInitialLeader =
        this.env.P3_TEST_MODE === "true" && isSeat(payload.initialLeader)
          ? payload.initialLeader
          : undefined;
      if (
        !(await this.startAuthority(
          meta,
          Number(payload.now),
          testInitialLeader,
        ))
      )
        return json({ error: "authority_unavailable" }, 503);
      this.ctx.storage.transactionSync(() => {
        this.ctx.storage.sql.exec(
          "UPDATE room_meta SET phase='started' WHERE id=1",
        );
        this.append({ type: "room.started", subjectId });
      });
      this.markPresence(subjectId, true, Number(payload.now));
      try {
        await this.reconcile(this.meta()!, Number(payload.now));
      } catch {
        return json({ error: "authority_unavailable" }, 503);
      }
      await this.notifyRealtime(meta.roomId).catch(() => undefined);
      return json({ room: this.projection(this.meta()!) });
    }
    return json({ error: "not_found" }, 404);
  }
}
