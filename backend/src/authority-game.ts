import {
  applyTableSessionAction,
  createTableSession,
  getSelectedPlayActions,
  parseSecureSeed,
  prepareNextTableSessionWithSecureSeed,
  type Seat,
  type TableSession,
  type TurnAction,
} from "@card-game/guandan-core";

export interface AuthorityEnv {
  readonly ROOM_SEED_ENCRYPTION_KEY?: string;
  /** 仅供 Miniflare 验收夹具使用；生产环境绝不设置。 */
  readonly P3_TEST_MODE?: string;
}

interface MetaRow extends Record<string, SqlStorageValue> {
  readonly gameId: string;
  readonly ownerId: string;
  readonly encryptedSeed: string;
  readonly expiresAt: number;
}

interface EventRow extends Record<string, SqlStorageValue> {
  readonly sequence: number;
  readonly payload: string;
}

type StoredEvent =
  | { readonly kind: "action"; readonly action: TurnAction }
  | { readonly kind: "next-round"; readonly encryptedSeed: string }
  | { readonly kind: "test-complete-fixture" };

function json(value: unknown, status = 200): Response {
  return new Response(JSON.stringify(value), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store",
    },
  });
}

function secureSeed(): string {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join(
    "",
  );
}
function opaqueId(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}

function key(env: AuthorityEnv): Promise<CryptoKey> {
  const encoded = env.ROOM_SEED_ENCRYPTION_KEY;
  if (!encoded || !/^[A-Za-z0-9_-]{43}$/.test(encoded))
    throw new Error("seed_key_unavailable");
  const binary = atob(encoded.replaceAll("-", "+").replaceAll("_", "/"));
  const bytes = Uint8Array.from(binary, (c) => c.charCodeAt(0));
  return crypto.subtle.importKey(
    "raw",
    bytes.buffer as ArrayBuffer,
    "AES-GCM",
    false,
    ["encrypt", "decrypt"],
  );
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
  return Uint8Array.from(atob(padded), (c) => c.charCodeAt(0));
}

async function encryptSeed(seed: string, env: AuthorityEnv): Promise<string> {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ciphertext = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv: iv.buffer as ArrayBuffer },
    await key(env),
    new TextEncoder().encode(seed),
  );
  return `${bytesToBase64Url(iv)}.${bytesToBase64Url(new Uint8Array(ciphertext))}`;
}

async function decryptSeed(value: string, env: AuthorityEnv): Promise<string> {
  const [iv, ciphertext] = value.split(".");
  if (!iv || !ciphertext) throw new Error("seed_decrypt_failed");
  const plain = await crypto.subtle.decrypt(
    { name: "AES-GCM", iv: base64UrlToBytes(iv).buffer as ArrayBuffer },
    await key(env),
    base64UrlToBytes(ciphertext).buffer as ArrayBuffer,
  );
  return new TextDecoder().decode(plain);
}

function view(session: TableSession, seat: Seat) {
  const cards = session.game.state.hands[seat]
    .map((id) => session.game.cardsById.get(id))
    .filter((card) => card !== undefined);
  return {
    seat,
    hand: cards,
    current: session.game.state.current,
    leader: session.game.state.leader,
    passes: session.game.state.passes,
    finished: session.game.state.finished,
    remainingCardCounts: Object.fromEntries(
      (["east", "south", "west", "north"] as const).map((s) => [
        s,
        session.game.state.hands[s].length,
      ]),
    ),
    publicEvents: session.game.publicEvents,
  };
}

function completedFixture(session: TableSession): TableSession {
  const finish = ["south", "north", "east", "west"] as const;
  return {
    ...session,
    game: {
      ...session.game,
      state: { ...session.game.state, completed: true, finished: finish },
    },
    match: { ...session.match, currentFinish: finish },
  };
}

/** Internal-only DO: P3-05 owns public room lifecycle and seat allocation. */
export class AuthorityGameDurableObject {
  constructor(
    private readonly ctx: DurableObjectState,
    private readonly env: AuthorityEnv,
  ) {}

  private setup(): void {
    this.ctx.storage.sql.exec(
      "CREATE TABLE IF NOT EXISTS meta (id INTEGER PRIMARY KEY CHECK(id=1), game_id TEXT NOT NULL, owner_id TEXT NOT NULL, encrypted_seed TEXT NOT NULL, expires_at INTEGER NOT NULL)",
    );
    this.ctx.storage.sql.exec(
      "CREATE TABLE IF NOT EXISTS events (sequence INTEGER PRIMARY KEY, payload TEXT NOT NULL)",
    );
    this.ctx.storage.sql.exec(
      "CREATE TABLE IF NOT EXISTS commands (command_id TEXT PRIMARY KEY, response TEXT NOT NULL)",
    );
    this.ctx.storage.sql.exec(
      "CREATE TABLE IF NOT EXISTS snapshots (event_sequence INTEGER PRIMARY KEY, payload TEXT NOT NULL)",
    );
  }
  private meta(): MetaRow | undefined {
    return [
      ...this.ctx.storage.sql.exec<MetaRow>(
        "SELECT game_id as gameId, owner_id as ownerId, encrypted_seed as encryptedSeed, expires_at as expiresAt FROM meta WHERE id=1",
      ),
    ][0];
  }
  private async restore(meta: MetaRow): Promise<TableSession> {
    const seed = parseSecureSeed(
      await decryptSeed(meta.encryptedSeed, this.env),
    );
    const latestSnapshot = [
      ...this.ctx.storage.sql.exec<{ eventSequence: number; payload: string }>(
        "SELECT event_sequence as eventSequence, payload FROM snapshots ORDER BY event_sequence DESC LIMIT 1",
      ),
    ][0];
    if (latestSnapshot) {
      let snapshot: { readonly eventSequence?: unknown };
      try {
        snapshot = JSON.parse(latestSnapshot.payload) as {
          readonly eventSequence?: unknown;
        };
      } catch {
        throw new Error("snapshot_corrupt");
      }
      if (snapshot.eventSequence !== latestSnapshot.eventSequence)
        throw new Error("snapshot_sequence_mismatch");
    }
    let session = createTableSession(seed);
    for (const row of this.ctx.storage.sql.exec<EventRow>(
      "SELECT sequence, payload FROM events ORDER BY sequence",
    )) {
      const stored = JSON.parse(row.payload) as StoredEvent;
      if (stored.kind === "action") {
        const next = applyTableSessionAction(session, stored.action);
        if (!next.ok || next.session.stream.events.length - 1 !== row.sequence)
          throw new Error("stored_event_invalid");
        session = next.session;
      } else if (stored.kind === "next-round") {
        const roundSeed = parseSecureSeed(
          await decryptSeed(stored.encryptedSeed, this.env),
        );
        session = prepareNextTableSessionWithSecureSeed(session, roundSeed);
        if (session.stream.events.length - 1 !== row.sequence)
          throw new Error("stored_event_invalid");
      } else if (
        stored.kind === "test-complete-fixture" &&
        this.env.P3_TEST_MODE === "true"
      ) {
        session = completedFixture(session);
      } else {
        throw new Error("stored_event_invalid");
      }
    }
    if (
      latestSnapshot &&
      latestSnapshot.eventSequence !== session.stream.events.length - 1
    )
      throw new Error("snapshot_event_gap");
    if (
      latestSnapshot &&
      latestSnapshot.payload !==
        JSON.stringify({
          eventSequence: latestSnapshot.eventSequence,
          state: view(session, "south"),
        })
    )
      throw new Error("snapshot_replay_mismatch");
    return session;
  }

  private async auditSeed(meta: MetaRow): Promise<{
    readonly seedFingerprint: string;
    readonly seedHexLength: number;
    readonly roundSeedFingerprint: string;
    readonly roundNumber: number;
  }> {
    const seed = await decryptSeed(meta.encryptedSeed, this.env);
    const fingerprint = async (value: string) =>
      bytesToBase64Url(
        new Uint8Array(
          await crypto.subtle.digest(
            "SHA-256",
            new TextEncoder().encode(value),
          ),
        ),
      );
    const session = await this.restore(meta);
    return {
      seedFingerprint: await fingerprint(seed),
      seedHexLength: seed.length,
      roundSeedFingerprint: await fingerprint(String(session.match.roundSeed)),
      roundNumber: session.match.roundNumber,
    };
  }

  private unavailableState(): Response {
    // Never expose encrypted storage, a seed, or a parser/replay error to callers.
    return json({ error: "authority_state_unavailable" }, 503);
  }
  async fetch(request: Request): Promise<Response> {
    this.setup();
    const path = new URL(request.url).pathname;
    const payload =
      request.method === "GET"
        ? {}
        : ((await request.json()) as Record<string, unknown>);
    if (path === "/initialize") {
      if (
        typeof payload.ownerId !== "string" ||
        typeof payload.now !== "number"
      )
        return json({ error: "invalid_payload" }, 400);
      if (this.meta()) return json({ error: "already_initialized" }, 409);
      const encryptedSeed = await encryptSeed(secureSeed(), this.env);
      const gameId = opaqueId();
      this.ctx.storage.sql.exec(
        "INSERT INTO meta (id, game_id, owner_id, encrypted_seed, expires_at) VALUES (1, ?, ?, ?, ?)",
        gameId,
        payload.ownerId,
        encryptedSeed,
        payload.now + 2_592_000_000,
      );
      return json({ ok: true, gameId }, 201);
    }
    const meta = this.meta();
    if (!meta) return json({ error: "not_initialized" }, 404);
    if (typeof payload.now !== "number" || payload.now >= meta.expiresAt) {
      this.ctx.storage.transactionSync(() => {
        this.ctx.storage.sql.exec("DELETE FROM commands");
        this.ctx.storage.sql.exec("DELETE FROM snapshots");
        this.ctx.storage.sql.exec("DELETE FROM events");
        this.ctx.storage.sql.exec("DELETE FROM meta");
      });
      return json({ error: "room_expired" }, 410);
    }
    if (payload.subjectId !== meta.ownerId)
      return json({ error: "forbidden" }, 403);
    // These routes are deliberately unreachable from the public Worker router and
    // only enabled by the local Miniflare fixture. They prove persistence invariants
    // without adding a client-facing audit or state-mutation API.
    if (this.env.P3_TEST_MODE === "true" && path === "/internal-audit")
      return json({ gameId: meta.gameId, ...(await this.auditSeed(meta)) });
    if (
      this.env.P3_TEST_MODE === "true" &&
      path === "/internal-corrupt-snapshot"
    ) {
      this.ctx.storage.sql.exec(
        "UPDATE snapshots SET payload=? WHERE event_sequence=(SELECT MAX(event_sequence) FROM snapshots)",
        JSON.stringify({ eventSequence: -1, state: { corrupt: true } }),
      );
      return json({ ok: true });
    }
    if (
      this.env.P3_TEST_MODE === "true" &&
      path === "/internal-complete-round"
    ) {
      this.ctx.storage.sql.exec(
        "INSERT OR REPLACE INTO events (sequence, payload) VALUES (?, ?)",
        -1,
        JSON.stringify({ kind: "test-complete-fixture" } satisfies StoredEvent),
      );
      return json({ ok: true });
    }
    if (path === "/new-game") {
      const encryptedSeed = await encryptSeed(secureSeed(), this.env);
      const gameId = opaqueId();
      this.ctx.storage.transactionSync(() => {
        this.ctx.storage.sql.exec("DELETE FROM commands");
        this.ctx.storage.sql.exec("DELETE FROM snapshots");
        this.ctx.storage.sql.exec("DELETE FROM events");
        this.ctx.storage.sql.exec(
          "UPDATE meta SET game_id=?, encrypted_seed=? WHERE id=1",
          gameId,
          encryptedSeed,
        );
      });
      return json({ ok: true, gameId });
    }
    if (path === "/view") {
      try {
        return json(view(await this.restore(meta), "south"));
      } catch {
        return this.unavailableState();
      }
    }
    if (path === "/replay") {
      try {
        const session = await this.restore(meta);
        return json({
          gameId: meta.gameId,
          eventCount: session.stream.events.length,
          rulesVersion: session.stream.rulesVersion,
        });
      } catch {
        return this.unavailableState();
      }
    }
    if (path === "/next-round") {
      if (typeof payload.commandId !== "string")
        return json({ error: "invalid_payload" }, 400);
      const duplicate = [
        ...this.ctx.storage.sql.exec<{ response: string }>(
          "SELECT response FROM commands WHERE command_id=?",
          payload.commandId,
        ),
      ][0];
      if (duplicate) return json(JSON.parse(duplicate.response));
      let session: TableSession;
      try {
        session = await this.restore(meta);
      } catch {
        return this.unavailableState();
      }
      if (!session.game.state.completed)
        return json({ error: "round_not_complete" }, 422);
      const nextSeed = parseSecureSeed(secureSeed());
      if (nextSeed === session.match.roundSeed)
        return json({ error: "seed_regeneration_failed" }, 503);
      let next: TableSession;
      try {
        next = prepareNextTableSessionWithSecureSeed(session, nextSeed);
      } catch {
        return json({ error: "round_transition_rejected" }, 422);
      }
      const event = next.stream.events.at(-1)!;
      const stored: StoredEvent = {
        kind: "next-round",
        encryptedSeed: await encryptSeed(nextSeed, this.env),
      };
      const response = {
        acknowledged: true,
        commandId: payload.commandId,
        eventSequence: event.sequence,
        view: view(next, "south"),
      };
      this.ctx.storage.transactionSync(() => {
        this.ctx.storage.sql.exec(
          "INSERT INTO events (sequence, payload) VALUES (?, ?)",
          event.sequence,
          JSON.stringify(stored),
        );
        this.ctx.storage.sql.exec(
          "INSERT INTO snapshots (event_sequence, payload) VALUES (?, ?)",
          event.sequence,
          JSON.stringify({
            eventSequence: event.sequence,
            state: view(next, "south"),
          }),
        );
        this.ctx.storage.sql.exec(
          "INSERT INTO commands (command_id, response) VALUES (?, ?)",
          payload.commandId,
          JSON.stringify(response),
        );
      });
      return json(response);
    }
    if (
      path !== "/command" ||
      typeof payload.commandId !== "string" ||
      typeof payload.kind !== "string"
    )
      return json({ error: "invalid_payload" }, 400);
    const duplicate = [
      ...this.ctx.storage.sql.exec<{ response: string }>(
        "SELECT response FROM commands WHERE command_id=?",
        payload.commandId,
      ),
    ][0];
    if (duplicate) return json(JSON.parse(duplicate.response));
    let session: TableSession;
    try {
      session = await this.restore(meta);
    } catch {
      return this.unavailableState();
    }
    let action: TurnAction | undefined;
    if (payload.kind === "pass") action = { type: "pass", actor: "south" };
    if (
      payload.kind === "play" &&
      Array.isArray(payload.cardIds) &&
      payload.cardIds.every((id) => typeof id === "string")
    )
      action = getSelectedPlayActions(session.game, payload.cardIds)[0];
    if (!action) return json({ error: "invalid_action" }, 422);
    const result = applyTableSessionAction(session, action);
    if (!result.ok) return json({ error: result.code }, 422);
    const event = result.session.stream.events.at(-1)!;
    const response = {
      acknowledged: true,
      commandId: payload.commandId,
      eventSequence: event.sequence,
      view: view(result.session, "south"),
    };
    this.ctx.storage.transactionSync(() => {
      this.ctx.storage.sql.exec(
        "INSERT INTO events (sequence, payload) VALUES (?, ?)",
        event.sequence,
        JSON.stringify({ kind: "action", action } satisfies StoredEvent),
      );
      this.ctx.storage.sql.exec(
        "INSERT INTO snapshots (event_sequence, payload) VALUES (?, ?)",
        event.sequence,
        JSON.stringify({
          eventSequence: event.sequence,
          state: view(result.session, "south"),
        }),
      );
      this.ctx.storage.sql.exec(
        "INSERT INTO commands (command_id, response) VALUES (?, ?)",
        payload.commandId,
        JSON.stringify(response),
      );
    });
    return json(response);
  }
}
