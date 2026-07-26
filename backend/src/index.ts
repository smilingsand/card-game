import {
  MAX_JSON_BYTES,
  clearReconnectCookie,
  createAnonymousSubjectId,
  createReconnectToken,
  hashToken,
  parseReconnectCookie,
  parseRuntimeConfig,
  reconnectCookie,
  redactLogFields,
  validateEmptyObject,
  type ReconnectCredential,
  type RuntimeConfig,
} from "./security";
export { AuthorityGameDurableObject } from "./authority-game";
export { RoomDurableObject } from "./room";
export { RealtimeRoomDurableObject } from "./realtime-room";

export interface Env {
  AUTH_SESSION: DurableObjectNamespace;
  RATE_LIMITER: DurableObjectNamespace;
  AUTHORITY_GAME: DurableObjectNamespace;
  ROOM: DurableObjectNamespace;
  REALTIME_ROOM: DurableObjectNamespace;
  ROOM_SEED_ENCRYPTION_KEY?: string;
  ROOM_INVITE_HASH_KEY?: string;
  /** 仅本地 P3-04 fixture；生产环境不得设置。 */
  P3_TEST_MODE?: string;
  ENVIRONMENT?: string;
  SESSION_TTL_SECONDS?: string;
  RATE_LIMIT_PER_MINUTE?: string;
}

interface SessionRecord extends Record<string, SqlStorageValue> {
  readonly subjectId: string;
  readonly tokenHash: string;
  readonly expiresAt: number;
}

interface RateDecision {
  readonly allowed: boolean;
  readonly retryAfterSeconds: number;
}

function json(
  body: unknown,
  status = 200,
  headers: HeadersInit = {},
): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store",
      ...headers,
    },
  });
}

function error(
  code: string,
  status: number,
  headers: HeadersInit = {},
): Response {
  return json({ error: code }, status, headers);
}

async function parseJsonObject(
  request: Request,
  maxBytes = MAX_JSON_BYTES,
): Promise<Record<string, unknown>> {
  const length = Number(request.headers.get("content-length") ?? "0");
  if (!Number.isFinite(length) || length > maxBytes)
    throw new Error("payload_too_large");
  const text = await request.text();
  if (new TextEncoder().encode(text).byteLength > maxBytes)
    throw new Error("payload_too_large");
  try {
    const value = JSON.parse(text || "{}");
    if (typeof value !== "object" || value === null || Array.isArray(value))
      throw new Error("invalid_payload");
    return value as Record<string, unknown>;
  } catch {
    throw new Error("invalid_payload");
  }
}

async function authStub(
  env: Env,
  subjectId: string,
): Promise<DurableObjectStub> {
  return env.AUTH_SESSION.get(env.AUTH_SESSION.idFromName(subjectId));
}

async function callSession(
  env: Env,
  subjectId: string,
  action: string,
  body: Record<string, unknown>,
): Promise<Response> {
  const stub = await authStub(env, subjectId);
  return stub.fetch("https://auth.internal/" + action, {
    method: "POST",
    body: JSON.stringify(body),
  });
}

async function rateDecision(
  env: Env,
  key: string,
  limit: number,
): Promise<RateDecision> {
  const stub = env.RATE_LIMITER.get(
    env.RATE_LIMITER.idFromName("p3-03-security-gate"),
  );
  const response = await stub.fetch("https://rate.internal/check", {
    method: "POST",
    body: JSON.stringify({ key, limit, now: Date.now() }),
  });
  return (await response.json()) as RateDecision;
}

function runtimeConfigForEnv(env: Env): RuntimeConfig {
  return parseRuntimeConfig({
    ENVIRONMENT: env.ENVIRONMENT,
    SESSION_TTL_SECONDS: env.SESSION_TTL_SECONDS,
    RATE_LIMIT_PER_MINUTE: env.RATE_LIMIT_PER_MINUTE,
  });
}

async function requireSession(
  request: Request,
  env: Env,
): Promise<ReconnectCredential | Response> {
  const credential = parseReconnectCookie(request.headers.get("cookie"));
  if (!credential) return error("unauthorized", 401);
  const response = await callSession(env, credential.subjectId, "validate", {
    tokenHash: await hashToken(credential.token),
    now: Date.now(),
  });
  if (!response.ok)
    return error("unauthorized", 401, {
      "set-cookie": clearReconnectCookie(runtimeConfigForEnv(env)),
    });
  return credential;
}

function requestRateKey(request: Request): string {
  return request.headers.get("cf-connecting-ip") ?? "local-anonymous";
}

function securityLog(event: string, fields: Record<string, unknown>): void {
  console.info(JSON.stringify({ event, ...redactLogFields(fields) }));
}

function createRoomId(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  let raw = "";
  for (const byte of bytes) raw += String.fromCharCode(byte);
  return btoa(raw)
    .replaceAll("+", "-")
    .replaceAll("/", "_")
    .replace(/=+$/u, "");
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    let config: RuntimeConfig;
    try {
      config = runtimeConfigForEnv(env);
    } catch {
      return error("invalid_server_configuration", 503);
    }
    const url = new URL(request.url);
    if (request.method === "GET" && url.pathname === "/health")
      return json({ status: "ok", service: "card-game-backend" });
    if (!url.pathname.startsWith("/v1/")) return error("not_found", 404);

    let postBody: Record<string, unknown> | undefined;
    if (request.method === "POST") {
      try {
        const testRecovery =
          env.P3_TEST_MODE === "true" &&
          /^\/v1\/authority\/[A-Za-z0-9_-]{1,128}\/restore$/u.test(
            url.pathname,
          );
        postBody = await parseJsonObject(
          request,
          testRecovery ? 128 * 1_024 : MAX_JSON_BYTES,
        );
      } catch (cause) {
        const code = cause instanceof Error ? cause.message : "invalid_payload";
        securityLog("request_rejected", {
          method: request.method,
          route: url.pathname,
          reason: code,
        });
        return error(code, code === "payload_too_large" ? 413 : 400);
      }
    }
    if (["/v1/session", "/v1/session/rotate"].includes(url.pathname))
      try {
        validateEmptyObject(postBody ?? {});
      } catch {
        securityLog("request_rejected", {
          method: request.method,
          route: url.pathname,
          reason: "invalid_payload",
        });
        return error("invalid_payload", 400);
      }
    const decision = await rateDecision(
      env,
      requestRateKey(request),
      config.rateLimitPerMinute,
    );
    if (!decision.allowed) {
      securityLog("rate_limited", {
        method: request.method,
        route: url.pathname,
      });
      return error("rate_limited", 429, {
        "retry-after": String(decision.retryAfterSeconds),
      });
    }

    if (request.method === "POST" && url.pathname === "/v1/session") {
      const subjectId = createAnonymousSubjectId();
      const token = createReconnectToken();
      const response = await callSession(env, subjectId, "issue", {
        subjectId,
        tokenHash: await hashToken(token),
        expiresAt: Date.now() + config.sessionTtlSeconds * 1_000,
      });
      if (!response.ok) return error("session_unavailable", 503);
      securityLog("session_issued", { subjectId, token });
      return json({ anonymousId: subjectId }, 201, {
        "set-cookie": reconnectCookie({ subjectId, token }, config),
      });
    }

    const authenticated = await requireSession(request, env);
    if (authenticated instanceof Response) {
      securityLog("authentication_rejected", {
        method: request.method,
        route: url.pathname,
      });
      return authenticated;
    }
    const realtimeRoom = /^\/v1\/rooms\/([A-Za-z0-9_-]{22})\/realtime$/u.exec(
      url.pathname,
    );
    if (realtimeRoom) {
      if (
        request.method !== "GET" ||
        request.headers.get("upgrade")?.toLowerCase() !== "websocket"
      )
        return error("websocket_upgrade_required", 426);
      const roomId = realtimeRoom[1];
      const realtime = env.REALTIME_ROOM.get(
        env.REALTIME_ROOM.idFromName(roomId),
      );
      return realtime.fetch(
        `https://realtime.internal/connect?roomId=${encodeURIComponent(roomId)}`,
        {
          headers: {
            Upgrade: "websocket",
            "x-p3-internal-subject": authenticated.subjectId,
          },
        },
      );
    }
    // P3-04 legacy fixture: these routes remain unavailable in non-test
    // runtimes. P3-05 public traffic enters only through room lifecycle APIs.
    const authority =
      env.P3_TEST_MODE === "true"
        ? /^\/v1\/authority\/([A-Za-z0-9_-]{1,128})(?:\/(command|view|replay|new-game|next-round|backup|restore|corrupt|corrupt-event-gap))?$/u.exec(
            url.pathname,
          )
        : undefined;
    if (authority) {
      const [, roomId, action] = authority;
      if (
        (request.method === "POST" && !action) ||
        (request.method === "POST" &&
          (action === "command" ||
            action === "new-game" ||
            action === "next-round" ||
            action === "backup" ||
            action === "restore" ||
            action === "corrupt" ||
            action === "corrupt-event-gap")) ||
        (request.method === "GET" && (action === "view" || action === "replay"))
      ) {
        let body: Record<string, unknown> = {};
        if (request.method === "POST") body = postBody ?? {};
        const stub = env.AUTHORITY_GAME.get(
          env.AUTHORITY_GAME.idFromName(roomId),
        );
        return stub.fetch(
          "https://authority.internal/" +
            (action === "backup"
              ? "internal-backup"
              : action === "restore"
                ? "internal-restore"
                : action === "corrupt"
                  ? "internal-corrupt-snapshot"
                  : action === "corrupt-event-gap"
                    ? "internal-corrupt-event-gap"
                    : (action ?? "initialize")),
          {
            method: "POST",
            body: JSON.stringify({
              ...body,
              subjectId: authenticated.subjectId,
              ownerId: authenticated.subjectId,
              now: Date.now(),
            }),
          },
        );
      }
    }
    const roomMatch =
      /^\/v1\/rooms\/([A-Za-z0-9_-]{22})\/(join|ready|start|view|game-view|actions|presence|seat-requests|seat-requests\/approve)$/u.exec(
        url.pathname,
      );
    const isRoomCreate =
      request.method === "POST" && url.pathname === "/v1/rooms";
    if (isRoomCreate || roomMatch) {
      const action = isRoomCreate ? "create" : roomMatch![2];
      const roomId = isRoomCreate ? createRoomId() : roomMatch![1];
      const methodAllowed =
        isRoomCreate || (action !== "view" && action !== "game-view")
          ? request.method === "POST"
          : request.method === "GET";
      if (!methodAllowed) return error("not_found", 404);
      let body: Record<string, unknown> = {};
      if (request.method === "POST") body = postBody ?? {};
      const room = env.ROOM.get(env.ROOM.idFromName(roomId));
      const requestNow =
        env.P3_TEST_MODE === "true" &&
        typeof body.now === "number" &&
        Number.isFinite(body.now)
          ? body.now
          : Date.now();
      const internalAction =
        action === "seat-requests"
          ? "seat-request"
          : action === "seat-requests/approve"
            ? "approve-seat-request"
            : action === "actions"
              ? "authority-command"
              : action === "game-view"
                ? "authority-view"
                : action === "presence"
                  ? "presence"
                  : action;
      return room.fetch(`https://room.internal/${internalAction}`, {
        method: "POST",
        body: JSON.stringify({
          ...body,
          roomId,
          subjectId: authenticated.subjectId,
          now: requestNow,
        }),
      });
    }
    if (request.method === "GET" && url.pathname === "/v1/session")
      return json({ anonymousId: authenticated.subjectId });
    if (request.method === "POST" && url.pathname === "/v1/session/rotate") {
      const token = createReconnectToken();
      const response = await callSession(
        env,
        authenticated.subjectId,
        "rotate",
        {
          oldTokenHash: await hashToken(authenticated.token),
          newTokenHash: await hashToken(token),
          expiresAt: Date.now() + config.sessionTtlSeconds * 1_000,
          now: Date.now(),
        },
      );
      if (!response.ok)
        return error("unauthorized", 401, {
          "set-cookie": clearReconnectCookie(config),
        });
      securityLog("session_rotated", {
        subjectId: authenticated.subjectId,
        token,
      });
      return json({ anonymousId: authenticated.subjectId }, 200, {
        "set-cookie": reconnectCookie(
          { subjectId: authenticated.subjectId, token },
          config,
        ),
      });
    }
    return error("not_found", 404);
  },
} satisfies ExportedHandler<Env>;

export class AuthSessionDurableObject {
  constructor(
    private readonly ctx: DurableObjectState,
    _env: Env,
  ) {}
  async fetch(request: Request): Promise<Response> {
    const action = new URL(request.url).pathname.slice(1);
    const payload = (await request.json()) as Record<string, unknown>;
    this.ctx.storage.sql.exec(
      "CREATE TABLE IF NOT EXISTS session (id INTEGER PRIMARY KEY CHECK (id = 1), subject_id TEXT NOT NULL, token_hash TEXT NOT NULL, expires_at INTEGER NOT NULL)",
    );
    const row = [
      ...this.ctx.storage.sql.exec<SessionRecord>(
        "SELECT subject_id as subjectId, token_hash as tokenHash, expires_at as expiresAt FROM session WHERE id = 1",
      ),
    ][0];
    if (action === "issue") {
      if (row) return error("already_issued", 409);
      this.ctx.storage.sql.exec(
        "INSERT INTO session (id, subject_id, token_hash, expires_at) VALUES (1, ?, ?, ?)",
        payload.subjectId,
        payload.tokenHash,
        payload.expiresAt,
      );
      return json({ ok: true });
    }
    if (
      !row ||
      (typeof payload.now !== "number" && action !== "validate") ||
      row.expiresAt <=
        (typeof payload.now === "number" ? payload.now : Date.now())
    )
      return error("unauthorized", 401);
    if (action === "validate" && payload.tokenHash === row.tokenHash)
      return json({ ok: true });
    if (action === "rotate" && payload.oldTokenHash === row.tokenHash) {
      this.ctx.storage.sql.exec(
        "UPDATE session SET token_hash = ?, expires_at = ? WHERE id = 1",
        payload.newTokenHash,
        payload.expiresAt,
      );
      return json({ ok: true });
    }
    return error("unauthorized", 401);
  }
}

export class RateLimiterDurableObject {
  constructor(
    private readonly ctx: DurableObjectState,
    _env: Env,
  ) {}
  async fetch(request: Request): Promise<Response> {
    const { key, limit, now } = (await request.json()) as {
      key: string;
      limit: number;
      now: number;
    };
    const windowStart = Math.floor(now / 60_000) * 60_000;
    this.ctx.storage.sql.exec(
      "CREATE TABLE IF NOT EXISTS rate_windows (key TEXT NOT NULL, window_start INTEGER NOT NULL, count INTEGER NOT NULL, PRIMARY KEY (key, window_start))",
    );
    const row = [
      ...this.ctx.storage.sql.exec<{ count: number }>(
        "SELECT count FROM rate_windows WHERE key = ? AND window_start = ?",
        key,
        windowStart,
      ),
    ][0];
    const count = (row?.count ?? 0) + 1;
    if (row)
      this.ctx.storage.sql.exec(
        "UPDATE rate_windows SET count = ? WHERE key = ? AND window_start = ?",
        count,
        key,
        windowStart,
      );
    else
      this.ctx.storage.sql.exec(
        "INSERT INTO rate_windows (key, window_start, count) VALUES (?, ?, ?)",
        key,
        windowStart,
        count,
      );
    return json({
      allowed: count <= limit,
      retryAfterSeconds: Math.max(
        1,
        Math.ceil((windowStart + 60_000 - now) / 1_000),
      ),
    });
  }
}
