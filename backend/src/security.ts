export interface RuntimeConfig {
  readonly environment: "local" | "production";
  readonly sessionTtlSeconds: number;
  readonly rateLimitPerMinute: number;
}

export const MAX_JSON_BYTES = 4_096;
const TOKEN_BYTES = 32;
const SUBJECT_BYTES = 16;

function parsePositiveInteger(
  value: string | undefined,
  fallback: number,
  name: string,
): number {
  if (value === undefined) return fallback;
  if (!/^\d+$/.test(value))
    throw new Error(`${name} must be a positive integer`);
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 1) {
    throw new Error(`${name} must be a positive integer`);
  }
  return parsed;
}

export function parseRuntimeConfig(
  values: Record<string, string | undefined>,
): RuntimeConfig {
  const environment = values.ENVIRONMENT ?? "local";
  if (environment !== "local" && environment !== "production") {
    throw new Error("ENVIRONMENT must be local or production");
  }
  const sessionTtlSeconds = parsePositiveInteger(
    values.SESSION_TTL_SECONDS,
    86_400,
    "SESSION_TTL_SECONDS",
  );
  const rateLimitPerMinute = parsePositiveInteger(
    values.RATE_LIMIT_PER_MINUTE,
    30,
    "RATE_LIMIT_PER_MINUTE",
  );
  if (sessionTtlSeconds > 2_592_000)
    throw new Error("SESSION_TTL_SECONDS exceeds 30 days");
  if (rateLimitPerMinute > 1_000)
    throw new Error("RATE_LIMIT_PER_MINUTE exceeds safe limit");
  return { environment, sessionTtlSeconds, rateLimitPerMinute };
}

function base64Url(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary)
    .replaceAll("+", "-")
    .replaceAll("/", "_")
    .replace(/=+$/u, "");
}

export function randomOpaqueId(byteLength: number): string {
  const bytes = new Uint8Array(byteLength);
  crypto.getRandomValues(bytes);
  return base64Url(bytes);
}

export function createAnonymousSubjectId(): string {
  return randomOpaqueId(SUBJECT_BYTES);
}

export function createReconnectToken(): string {
  return randomOpaqueId(TOKEN_BYTES);
}

export async function hashToken(token: string): Promise<string> {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(token),
  );
  return base64Url(new Uint8Array(digest));
}

export interface ReconnectCredential {
  readonly subjectId: string;
  readonly token: string;
}

export function parseReconnectCookie(
  cookieHeader: string | null,
): ReconnectCredential | undefined {
  const value = cookieHeader
    ?.split(";")
    .map((part) => part.trim())
    .find((part) => part.startsWith("p3_reconnect="))
    ?.slice("p3_reconnect=".length);
  if (!value) return undefined;
  const separator = value.indexOf(".");
  if (separator < 1 || separator === value.length - 1) return undefined;
  const subjectId = value.slice(0, separator);
  const token = value.slice(separator + 1);
  if (
    !/^[A-Za-z0-9_-]{20,}$/.test(subjectId) ||
    !/^[A-Za-z0-9_-]{40,}$/.test(token)
  ) {
    return undefined;
  }
  return { subjectId, token };
}

export function reconnectCookie(
  credential: ReconnectCredential,
  config: RuntimeConfig,
): string {
  const secure = config.environment === "production" ? "; Secure" : "";
  return `p3_reconnect=${credential.subjectId}.${credential.token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${config.sessionTtlSeconds}${secure}`;
}

export function clearReconnectCookie(config: RuntimeConfig): string {
  const secure = config.environment === "production" ? "; Secure" : "";
  return `p3_reconnect=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0${secure}`;
}

export function assertSubjectAccess(
  subjectId: string,
  resourceSubjectId: string,
): void {
  if (subjectId !== resourceSubjectId)
    throw new AuthorizationError("subject_mismatch");
}

export class AuthorizationError extends Error {}

export function redactLogFields(
  fields: Record<string, unknown>,
): Record<string, unknown> {
  const sensitive =
    /token|cookie|authorization|seed|card|hand|secret|subject|anonymous|identity/i;
  return Object.fromEntries(
    Object.entries(fields).map(([key, value]) => [
      key,
      sensitive.test(key) ? "[REDACTED]" : value,
    ]),
  );
}

export function validateEmptyObject(value: unknown): void {
  if (
    typeof value !== "object" ||
    value === null ||
    Array.isArray(value) ||
    Object.keys(value).length !== 0
  ) {
    throw new InputError("invalid_payload");
  }
}

export class InputError extends Error {}
