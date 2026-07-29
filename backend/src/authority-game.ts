import {
  applyTableSessionAction,
  createTableSession,
  chooseTableBotAction,
  formatCard,
  formatInterpretation,
  getLegalBotActions,
  getSouthReturnChoices,
  getSouthTributeChoices,
  getSelectedPlayActions,
  latestRecentActionsBySeat,
  parseSecureSeed,
  prepareNextTableSessionWithSecureSeed,
  restartCurrentTableSession,
  submitSouthReturn,
  submitSouthTribute,
  type Seat,
  type TableSession,
  type TurnAction,
} from "@card-game/guandan-core";
import {
  backupChecksum,
  operationalLog,
  verifyAuthorityBackup,
  type AuthorityBackup,
} from "./observability";

export interface AuthorityEnv {
  readonly ROOM_SEED_ENCRYPTION_KEY?: string;
  /** 仅供 Miniflare 验收夹具使用；生产环境绝不设置。 */
  readonly P3_TEST_MODE?: string;
  /** 仅供可重现的 Miniflare 固定牌例使用；不可用于生产。 */
  readonly P3_TEST_SEED?: string;
}

interface MetaRow extends Record<string, SqlStorageValue> {
  readonly gameId: string;
  readonly ownerId: string;
  readonly encryptedSeed: string;
  readonly expiresAt: number;
  readonly initialLeader: Seat;
}

interface ControllerRow extends Record<string, SqlStorageValue> {
  readonly seat: Seat;
  readonly subjectId: string;
}

interface EventRow extends Record<string, SqlStorageValue> {
  readonly sequence: number;
  readonly payload: string;
}

interface CommandRow extends Record<string, SqlStorageValue> {
  readonly commandId: string;
  readonly response: string;
}

type StoredEvent =
  | { readonly kind: "action"; readonly action: TurnAction }
  | {
      readonly kind: "tribute";
      readonly action: "tribute" | "return";
      readonly cardId: string;
    }
  | { readonly kind: "next-round"; readonly encryptedSeed: string }
  | { readonly kind: "restart-current-round"; readonly encryptedSeed: string }
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

function view(
  session: TableSession,
  seat: Seat,
  includeLegalActions = false,
  gameId?: string,
) {
  const downstream: Record<Seat, Seat> = {
    south: "east",
    east: "north",
    north: "west",
    west: "south",
  };
  const upstream: Record<Seat, Seat> = {
    south: "west",
    east: "south",
    north: "east",
    west: "north",
  };
  const cards = session.game.state.hands[seat]
    .map((id) => session.game.cardsById.get(id))
    .filter((card) => card !== undefined);
  const highestPlay =
    session.game.state.highestSeat && session.game.state.highest
      ? {
          actor: session.game.state.highestSeat,
          cards: session.game.state.highest.cardIds
            .map((id) => session.game.cardsById.get(id))
            .filter((card) => card !== undefined),
          wildcardAs: session.game.state.highest.wildcardAs,
          patternLabel: formatInterpretation(session.game.state.highest),
        }
      : undefined;
  const publicActions = latestRecentActionsBySeat(
    session.game.publicEvents,
  ).map((action) => ({
    actor: action.actor,
    type: action.type,
    cards:
      action.type === "play"
        ? action.cardIds
            .map((id) => session.game.cardsById.get(id))
            .filter((card) => card !== undefined)
        : [],
    wildcardAs: action.type === "play" ? action.interpretation.wildcardAs : {},
  }));
  const activeLevelTeam =
    (session.match.previousFinish?.[0] ?? session.match.leader) === "south" ||
    (session.match.previousFinish?.[0] ?? session.match.leader) === "north"
      ? "northSouth"
      : "eastWest";
  const tributeSummary = session.match.tributePlan.antiTribute
    ? ["抗贡"]
    : session.match.tributePlan.obligations.map((obligation) => {
        const card = session.game.cardsById.get(obligation.cardId);
        const seatName: Record<Seat, string> = {
          south: "南家",
          east: "东家",
          north: "北家",
          west: "西家",
        };
        // Tribute is an explicitly public table exchange. This projection only
        // exposes that exchanged card, never a player's remaining hand.
        return `${seatName[obligation.from]}贡${card ? formatCard(card) : "牌"}`;
      });
  const tributeHint = session.match.previousFinish
    ? session.match.tributePlan.antiTribute
      ? "本局抗贡，无需进贡"
      : session.match.tributePhase === "ready"
        ? "下一局已准备完成"
        : "正在准备进贡"
    : "首局由南家先出";
  const tributeChoices =
    seat === "south"
      ? session.match.tributePhase === "awaiting-tribute"
        ? getSouthTributeChoices(session)
        : session.match.tributePhase === "awaiting-return"
          ? getSouthReturnChoices(session)
          : []
      : [];
  const tributeAction =
    tributeChoices.length > 0
      ? {
          kind:
            session.match.tributePhase === "awaiting-tribute"
              ? "tribute"
              : "return",
          cardIds: tributeChoices,
        }
      : undefined;
  return {
    ...(gameId ? { gameId } : {}),
    seat,
    // This is a public monotonic authority revision used for optimistic action
    // submission.  It is deliberately distinct from the relay's per-room
    // WebSocket sequence and contains no private game data.
    eventSequence: session.stream.events.length - 1,
    hand: cards,
    current: session.game.state.current,
    levelRank: session.game.levelRank ?? session.match.levelRank,
    match: {
      roundNumber: session.match.roundNumber,
      levels: session.match.levels,
      activeLevelTeam,
      previousFinish: session.match.previousFinish,
      tributeSummary,
      tributeHint,
    },
    ...(tributeAction ? { tributeAction } : {}),
    leader: session.game.state.leader,
    passes: session.game.state.passes,
    finished: session.game.state.finished,
    remainingCardCounts: Object.fromEntries(
      (["east", "south", "west", "north"] as const).map((s) => [
        s,
        session.game.state.hands[s].length,
      ]),
    ),
    publicActions,
    // The current winning play is public table state.  Send its card faces so
    // clients never have to infer them from a private hand projection.
    ...(highestPlay ? { highestPlay } : {}),
    // Legal actions are a personal projection.  Never compute them for another
    // seat: doing so would disclose card IDs and playable combinations from that
    // seat's private hand.
    legalActions:
      includeLegalActions && session.game.state.current === seat
        ? getLegalBotActions(session.game)
        : [],
    positions: {
      bottom: seat,
      left: upstream[seat],
      right: downstream[seat],
      top: downstream[downstream[seat]],
    },
  };
}

function isSeat(value: unknown): value is Seat {
  return (
    value === "south" ||
    value === "east" ||
    value === "north" ||
    value === "west"
  );
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
      "CREATE TABLE IF NOT EXISTS meta (id INTEGER PRIMARY KEY CHECK(id=1), game_id TEXT NOT NULL, owner_id TEXT NOT NULL, encrypted_seed TEXT NOT NULL, expires_at INTEGER NOT NULL, initial_leader TEXT NOT NULL DEFAULT 'south')",
    );
    this.ctx.storage.sql.exec(
      "CREATE TABLE IF NOT EXISTS controllers (seat TEXT PRIMARY KEY, subject_id TEXT NOT NULL UNIQUE)",
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
    this.ctx.storage.sql.exec(
      "CREATE TABLE IF NOT EXISTS turn_state (id INTEGER PRIMARY KEY CHECK(id=1), started_at INTEGER NOT NULL)",
    );
    this.ctx.storage.sql.exec(
      "CREATE TABLE IF NOT EXISTS bot_controls (seat TEXT PRIMARY KEY)",
    );
    this.ctx.storage.sql.exec(
      "CREATE TABLE IF NOT EXISTS backup_audit (id INTEGER PRIMARY KEY AUTOINCREMENT, created_at INTEGER NOT NULL, outcome TEXT NOT NULL, reason TEXT, event_sequence INTEGER)",
    );
  }
  private meta(): MetaRow | undefined {
    return [
      ...this.ctx.storage.sql.exec<MetaRow>(
        "SELECT game_id as gameId, owner_id as ownerId, encrypted_seed as encryptedSeed, expires_at as expiresAt, initial_leader as initialLeader FROM meta WHERE id=1",
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
    let session = createTableSession(seed, {
      initialLeader: meta.initialLeader,
    });
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
      } else if (stored.kind === "tribute") {
        session =
          stored.action === "tribute"
            ? submitSouthTribute(session, stored.cardId)
            : submitSouthReturn(session, stored.cardId);
        if (session.stream.events.length - 1 !== row.sequence)
          throw new Error("stored_event_invalid");
      } else if (stored.kind === "restart-current-round") {
        const roundSeed = parseSecureSeed(
          await decryptSeed(stored.encryptedSeed, this.env),
        );
        session = restartCurrentTableSession(session, roundSeed);
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

  private async backup(meta: MetaRow): Promise<AuthorityBackup> {
    const session = await this.restore(meta);
    const events = [
      ...this.ctx.storage.sql.exec<EventRow>(
        "SELECT sequence, payload FROM events ORDER BY sequence",
      ),
    ];
    const snapshot =
      [
        ...this.ctx.storage.sql.exec<{
          eventSequence: number;
          payload: string;
        }>(
          "SELECT event_sequence as eventSequence, payload FROM snapshots ORDER BY event_sequence DESC LIMIT 1",
        ),
      ][0] ?? null;
    const commands = [
      ...this.ctx.storage.sql.exec<CommandRow>(
        "SELECT command_id as commandId, response FROM commands ORDER BY command_id",
      ),
    ];
    const unsigned = {
      format: "p3-authority-backup-v1" as const,
      roomId: meta.ownerId.startsWith("room:")
        ? meta.ownerId.slice("room:".length)
        : meta.gameId,
      gameId: meta.gameId,
      rulesVersion: session.stream.rulesVersion,
      roundNumber: session.match.roundNumber,
      eventSequence: session.stream.events.length - 1,
      initialLeader: meta.initialLeader,
      encryptedSeed: meta.encryptedSeed,
      events,
      commands,
      snapshot,
    };
    return { ...unsigned, checksum: await backupChecksum(unsigned) };
  }

  private auditBackup(
    now: number,
    outcome: "ok" | "failed",
    reason: string | undefined,
    eventSequence: number | undefined,
    roomId: string,
  ): void {
    this.ctx.storage.sql.exec(
      "INSERT INTO backup_audit (created_at, outcome, reason, event_sequence) VALUES (?, ?, ?, ?)",
      now,
      outcome,
      reason ?? null,
      eventSequence ?? null,
    );
    operationalLog("authority_backup", {
      roomId,
      outcome,
      reason,
      eventSequence,
    });
  }

  private async restoreBackup(
    backup: AuthorityBackup,
    now: number,
    roomId: string,
  ): Promise<"ok" | "checksum_mismatch" | "event_sequence_gap"> {
    const verified = await verifyAuthorityBackup(backup);
    if (verified !== "ok") {
      this.auditBackup(now, "failed", verified, undefined, roomId);
      return verified;
    }
    this.ctx.storage.transactionSync(() => {
      this.ctx.storage.sql.exec("DELETE FROM commands");
      this.ctx.storage.sql.exec("DELETE FROM snapshots");
      this.ctx.storage.sql.exec("DELETE FROM events");
      this.ctx.storage.sql.exec(
        "UPDATE meta SET game_id=?, encrypted_seed=?, initial_leader=? WHERE id=1",
        backup.gameId,
        backup.encryptedSeed,
        backup.initialLeader,
      );
      for (const event of backup.events)
        this.ctx.storage.sql.exec(
          "INSERT INTO events (sequence, payload) VALUES (?, ?)",
          event.sequence,
          event.payload,
        );
      if (backup.snapshot)
        this.ctx.storage.sql.exec(
          "INSERT INTO snapshots (event_sequence, payload) VALUES (?, ?)",
          backup.snapshot.eventSequence,
          backup.snapshot.payload,
        );
      for (const command of backup.commands)
        this.ctx.storage.sql.exec(
          "INSERT INTO commands (command_id, response) VALUES (?, ?)",
          command.commandId,
          command.response,
        );
    });
    this.auditBackup(now, "ok", undefined, backup.eventSequence, roomId);
    return "ok";
  }

  private unavailableState(): Response {
    // Never expose encrypted storage, a seed, or a parser/replay error to callers.
    return json({ error: "authority_state_unavailable" }, 503);
  }
  private controllerSeat(subjectId: string): Seat | undefined {
    return [
      ...this.ctx.storage.sql.exec<ControllerRow>(
        "SELECT seat, subject_id as subjectId FROM controllers WHERE subject_id=?",
        subjectId,
      ),
    ][0]?.seat;
  }
  private botControlled(seat: Seat): boolean {
    return Boolean(
      [
        ...this.ctx.storage.sql.exec<{ seat: Seat }>(
          "SELECT seat FROM bot_controls WHERE seat=?",
          seat,
        ),
      ][0],
    );
  }
  private turnStartedAt(): number {
    return (
      [
        ...this.ctx.storage.sql.exec<{ startedAt: number }>(
          "SELECT started_at as startedAt FROM turn_state WHERE id=1",
        ),
      ][0]?.startedAt ?? 0
    );
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
      const now = payload.now;
      if (this.meta()) return json({ error: "already_initialized" }, 409);
      const controllers = payload.controllers;
      const suppliedControllers =
        controllers &&
        typeof controllers === "object" &&
        !Array.isArray(controllers)
          ? Object.entries(controllers as Record<string, unknown>)
          : [];
      if (
        suppliedControllers.some(
          ([seat, subjectId]) => !isSeat(seat) || typeof subjectId !== "string",
        ) ||
        new Set(suppliedControllers.map(([, subjectId]) => subjectId)).size !==
          suppliedControllers.length
      )
        return json({ error: "invalid_controllers" }, 400);
      const initialLeader = isSeat(payload.initialLeader)
        ? payload.initialLeader
        : "south";
      const bindings = suppliedControllers.length
        ? suppliedControllers.map(
            ([seat, subjectId]) => [seat as Seat, subjectId as string] as const,
          )
        : [["south", payload.ownerId] as const];
      let seed = secureSeed();
      if (this.env.P3_TEST_MODE === "true" && this.env.P3_TEST_SEED)
        try {
          seed = parseSecureSeed(this.env.P3_TEST_SEED);
        } catch {
          return json({ error: "invalid_test_seed" }, 422);
        }
      const encryptedSeed = await encryptSeed(seed, this.env);
      const gameId = opaqueId();
      this.ctx.storage.transactionSync(() => {
        this.ctx.storage.sql.exec(
          "INSERT INTO meta (id, game_id, owner_id, encrypted_seed, expires_at, initial_leader) VALUES (1, ?, ?, ?, ?, ?)",
          gameId,
          payload.ownerId,
          encryptedSeed,
          now + 2_592_000_000,
          initialLeader,
        );
        for (const [seat, subjectId] of bindings)
          this.ctx.storage.sql.exec(
            "INSERT INTO controllers (seat, subject_id) VALUES (?, ?)",
            seat,
            subjectId,
          );
        this.ctx.storage.sql.exec(
          "INSERT INTO turn_state (id, started_at) VALUES (1, ?)",
          now,
        );
      });
      return json({ ok: true, gameId }, 201);
    }
    const meta = this.meta();
    if (!meta) return json({ error: "not_initialized" }, 404);
    if (path === "/destroy") {
      if (payload.subjectId !== meta.ownerId)
        return json({ error: "forbidden" }, 403);
      this.ctx.storage.transactionSync(() => {
        this.ctx.storage.sql.exec("DELETE FROM backup_audit");
        this.ctx.storage.sql.exec("DELETE FROM bot_controls");
        this.ctx.storage.sql.exec("DELETE FROM turn_state");
        this.ctx.storage.sql.exec("DELETE FROM snapshots");
        this.ctx.storage.sql.exec("DELETE FROM commands");
        this.ctx.storage.sql.exec("DELETE FROM events");
        this.ctx.storage.sql.exec("DELETE FROM controllers");
        this.ctx.storage.sql.exec("DELETE FROM meta");
      });
      return json({ closed: true });
    }
    if (typeof payload.now !== "number" || payload.now >= meta.expiresAt) {
      this.ctx.storage.transactionSync(() => {
        this.ctx.storage.sql.exec("DELETE FROM commands");
        this.ctx.storage.sql.exec("DELETE FROM controllers");
        this.ctx.storage.sql.exec("DELETE FROM snapshots");
        this.ctx.storage.sql.exec("DELETE FROM events");
        this.ctx.storage.sql.exec("DELETE FROM meta");
      });
      return json({ error: "room_expired" }, 410);
    }
    const subjectSeat =
      typeof payload.subjectId === "string"
        ? this.controllerSeat(payload.subjectId)
        : undefined;
    const isOwner = payload.subjectId === meta.ownerId;
    if (!isOwner && !subjectSeat) return json({ error: "forbidden" }, 403);
    if (path === "/turn-status") {
      try {
        const session = await this.restore(meta);
        return json({
          gameId: meta.gameId,
          current: session.game.state.current,
          eventSequence: session.stream.events.length - 1,
          turnStartedAt: this.turnStartedAt(),
          botControlled: this.botControlled(session.game.state.current),
          completed: session.game.state.completed,
          tributePending: session.match.tributePhase !== "ready",
        });
      } catch {
        return this.unavailableState();
      }
    }
    if (path === "/bot-control") {
      if (
        !isOwner ||
        !isSeat(payload.seat) ||
        typeof payload.enabled !== "boolean"
      )
        return json({ error: "forbidden" }, 403);
      this.ctx.storage.transactionSync(() => {
        if (payload.enabled)
          this.ctx.storage.sql.exec(
            "INSERT OR IGNORE INTO bot_controls (seat) VALUES (?)",
            payload.seat,
          );
        else
          this.ctx.storage.sql.exec(
            "DELETE FROM bot_controls WHERE seat=?",
            payload.seat,
          );
      });
      return json({ ok: true });
    }
    // These routes are deliberately unreachable from the public Worker router and
    // only enabled by the local Miniflare fixture. They prove persistence invariants
    // without adding a client-facing audit or state-mutation API.
    if (this.env.P3_TEST_MODE === "true" && path === "/internal-audit")
      return json({ gameId: meta.gameId, ...(await this.auditSeed(meta)) });
    if (this.env.P3_TEST_MODE === "true" && path === "/internal-action-trace") {
      const commands = [
        ...this.ctx.storage.sql.exec<CommandRow>(
          "SELECT command_id as commandId, response FROM commands ORDER BY command_id",
        ),
      ].map((command) => {
        const response = JSON.parse(command.response) as {
          readonly acknowledged?: boolean;
          readonly eventSequence?: number;
        };
        return {
          commandId: command.commandId,
          acknowledged: response.acknowledged === true,
          eventSequence: response.eventSequence,
        };
      });
      const actions = [
        ...this.ctx.storage.sql.exec<EventRow>(
          "SELECT sequence, payload FROM events ORDER BY sequence",
        ),
      ].flatMap((row) => {
        const stored = JSON.parse(row.payload) as StoredEvent;
        if (stored.kind !== "action") return [];
        return [
          {
            eventSequence: row.sequence,
            actorSeat: stored.action.actor,
            actionType: stored.action.type,
            appliedCardIds:
              stored.action.type === "play" ? stored.action.cardIds : [],
          },
        ];
      });
      return json({ gameId: meta.gameId, commands, actions });
    }
    if (this.env.P3_TEST_MODE === "true" && path === "/internal-backup") {
      const roomId = meta.ownerId.startsWith("room:")
        ? meta.ownerId.slice("room:".length)
        : meta.gameId;
      try {
        const backup = await this.backup(meta);
        this.auditBackup(
          payload.now,
          "ok",
          undefined,
          backup.eventSequence,
          roomId,
        );
        return json(backup);
      } catch {
        this.auditBackup(
          payload.now,
          "failed",
          "backup_export_failed",
          undefined,
          roomId,
        );
        return json({ error: "backup_unavailable" }, 503);
      }
    }
    if (this.env.P3_TEST_MODE === "true" && path === "/internal-restore") {
      const backup = payload.backup as AuthorityBackup | undefined;
      if (!backup || typeof backup !== "object")
        return json({ error: "invalid_backup" }, 422);
      const roomId = meta.ownerId.startsWith("room:")
        ? meta.ownerId.slice("room:".length)
        : meta.gameId;
      const result = await this.restoreBackup(backup, payload.now, roomId);
      return result === "ok"
        ? json({ ok: true, eventSequence: backup.eventSequence })
        : json({ error: `backup_${result}` }, 422);
    }
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
      path === "/internal-corrupt-event-gap"
    ) {
      this.ctx.storage.sql.exec("DELETE FROM events WHERE sequence=0");
      return json({ ok: true });
    }
    if (
      this.env.P3_TEST_MODE === "true" &&
      path === "/internal-corrupt-event-gap"
    ) {
      this.ctx.storage.sql.exec("DELETE FROM events WHERE sequence=0");
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
      if (
        !isOwner ||
        typeof payload.commandId !== "string" ||
        !Number.isInteger(payload.expectedEventSequence)
      )
        return json({ error: "forbidden" }, 403);
      const duplicate = [
        ...this.ctx.storage.sql.exec<{ response: string }>(
          "SELECT response FROM commands WHERE command_id=?",
          payload.commandId,
        ),
      ][0];
      if (duplicate) return json(JSON.parse(duplicate.response));
      let current: TableSession;
      try {
        current = await this.restore(meta);
      } catch {
        return this.unavailableState();
      }
      if (payload.expectedEventSequence !== current.stream.events.length - 1)
        return json(
          {
            error: "event_sequence_conflict",
            eventSequence: current.stream.events.length - 1,
          },
          409,
        );
      const initialLeader = isSeat(payload.initialLeader)
        ? payload.initialLeader
        : meta.initialLeader;
      const seed = secureSeed();
      const encryptedSeed = await encryptSeed(seed, this.env);
      const gameId = opaqueId();
      const restarted = createTableSession(parseSecureSeed(seed), {
        initialLeader,
      });
      const response = {
        acknowledged: true,
        commandId: payload.commandId,
        gameId,
        eventSequence: restarted.stream.events.length - 1,
      };
      this.ctx.storage.transactionSync(() => {
        this.ctx.storage.sql.exec("DELETE FROM commands");
        this.ctx.storage.sql.exec("DELETE FROM snapshots");
        this.ctx.storage.sql.exec("DELETE FROM events");
        this.ctx.storage.sql.exec(
          "UPDATE meta SET game_id=?, encrypted_seed=?, initial_leader=? WHERE id=1",
          gameId,
          encryptedSeed,
          initialLeader,
        );
        this.ctx.storage.sql.exec(
          "INSERT INTO commands (command_id, response) VALUES (?, ?)",
          payload.commandId,
          JSON.stringify(response),
        );
        this.ctx.storage.sql.exec(
          "UPDATE turn_state SET started_at=? WHERE id=1",
          payload.now,
        );
      });
      return json(response);
    }
    if (path === "/restart-current-round") {
      if (
        !isOwner ||
        typeof payload.commandId !== "string" ||
        !Number.isInteger(payload.expectedEventSequence)
      )
        return json({ error: "forbidden" }, 403);
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
      if (payload.expectedEventSequence !== session.stream.events.length - 1)
        return json(
          {
            error: "event_sequence_conflict",
            eventSequence: session.stream.events.length - 1,
          },
          409,
        );
      const roundSeed = parseSecureSeed(secureSeed());
      let restarted: TableSession;
      try {
        restarted = restartCurrentTableSession(session, roundSeed);
      } catch {
        return json({ error: "round_restart_rejected" }, 422);
      }
      const event = restarted.stream.events.at(-1)!;
      const gameId = opaqueId();
      const encryptedSeed = await encryptSeed(roundSeed, this.env);
      const response = {
        acknowledged: true,
        commandId: payload.commandId,
        gameId,
        eventSequence: event.sequence,
      };
      this.ctx.storage.transactionSync(() => {
        this.ctx.storage.sql.exec("DELETE FROM commands");
        this.ctx.storage.sql.exec("DELETE FROM snapshots");
        this.ctx.storage.sql.exec(
          "INSERT INTO events (sequence, payload) VALUES (?, ?)",
          event.sequence,
          JSON.stringify({
            kind: "restart-current-round",
            encryptedSeed,
          } satisfies StoredEvent),
        );
        this.ctx.storage.sql.exec(
          "UPDATE meta SET game_id=? WHERE id=1",
          gameId,
        );
        this.ctx.storage.sql.exec(
          "INSERT INTO snapshots (event_sequence, payload) VALUES (?, ?)",
          event.sequence,
          JSON.stringify({
            eventSequence: event.sequence,
            state: view(restarted, "south"),
          }),
        );
        this.ctx.storage.sql.exec(
          "INSERT INTO commands (command_id, response) VALUES (?, ?)",
          payload.commandId,
          JSON.stringify(response),
        );
        this.ctx.storage.sql.exec(
          "UPDATE turn_state SET started_at=? WHERE id=1",
          payload.now,
        );
      });
      return json(response);
    }
    if (path === "/view") {
      try {
        return json(
          view(
            await this.restore(meta),
            subjectSeat ?? "south",
            true,
            meta.gameId,
          ),
        );
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
    if (path === "/bot-command") {
      if (!isOwner || typeof payload.commandId !== "string")
        return json({ error: "forbidden" }, 403);
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
      const seat = session.game.state.current;
      if (!this.botControlled(seat))
        return json({ error: "bot_not_controlling" }, 409);
      const decisionStartedAt = Date.now();
      const action = chooseTableBotAction(session.game);
      const decisionDurationMs = Date.now() - decisionStartedAt;
      if (!action || action.actor !== seat)
        return json({ error: "bot_action_unavailable" }, 422);
      const result = applyTableSessionAction(session, action);
      if (!result.ok) return json({ error: result.code }, 422);
      const event = result.session.stream.events.at(-1)!;
      const response = {
        acknowledged: true,
        commandId: payload.commandId,
        decisionDurationMs,
        eventSequence: event.sequence,
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
        this.ctx.storage.sql.exec(
          "UPDATE turn_state SET started_at=? WHERE id=1",
          payload.now,
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
    if (!subjectSeat) return json({ error: "forbidden" }, 403);
    if (this.botControlled(subjectSeat))
      return json({ error: "seat_under_bot_control" }, 409);
    if (payload.expectedEventSequence !== session.stream.events.length - 1)
      return json(
        {
          error: "event_sequence_conflict",
          eventSequence: session.stream.events.length - 1,
        },
        409,
      );
    if (
      (payload.kind === "tribute" || payload.kind === "return") &&
      subjectSeat === "south" &&
      Array.isArray(payload.cardIds) &&
      payload.cardIds.length === 1 &&
      typeof payload.cardIds[0] === "string"
    ) {
      const tributeKind: "tribute" | "return" = payload.kind;
      const tributeCardId = payload.cardIds[0];
      let next: TableSession;
      try {
        next =
          tributeKind === "tribute"
            ? submitSouthTribute(session, tributeCardId)
            : submitSouthReturn(session, tributeCardId);
      } catch {
        return json({ error: "invalid_tribute_card" }, 422);
      }
      const event = next.stream.events.at(-1)!;
      const response = {
        acknowledged: true,
        accepted: true,
        commandId: payload.commandId,
        eventSequence: event.sequence,
        appliedEventSequence: event.sequence,
        appliedCardIds: [tributeCardId],
        view: view(next, subjectSeat, false, meta.gameId),
      };
      this.ctx.storage.transactionSync(() => {
        this.ctx.storage.sql.exec(
          "INSERT INTO events (sequence, payload) VALUES (?, ?)",
          event.sequence,
          JSON.stringify({
            kind: "tribute",
            action: tributeKind,
            cardId: tributeCardId,
          } satisfies StoredEvent),
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
    if (session.game.state.current !== subjectSeat)
      return json({ error: "not_your_turn" }, 409);
    let action: TurnAction | undefined;
    if (payload.kind === "pass") action = { type: "pass", actor: subjectSeat };
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
      accepted: true,
      commandId: payload.commandId,
      eventSequence: event.sequence,
      appliedEventSequence: event.sequence,
      appliedCardIds: action.type === "play" ? action.cardIds : [],
      view: view(result.session, subjectSeat, false, meta.gameId),
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
      this.ctx.storage.sql.exec(
        "UPDATE turn_state SET started_at=? WHERE id=1",
        payload.now,
      );
    });
    return json(response);
  }
}
