// @vitest-environment node
import { expect, test } from "vitest";
import {
  assertSubjectAccess,
  createAnonymousSubjectId,
  createReconnectToken,
  parseReconnectCookie,
  parseRuntimeConfig,
  redactLogFields,
  reconnectCookie,
} from "../src/security";

test("P3-03: 配置 schema 拒绝不安全配置", () => {
  expect(() => parseRuntimeConfig({ ENVIRONMENT: "preview" })).toThrow(
    "ENVIRONMENT",
  );
  expect(() => parseRuntimeConfig({ RATE_LIMIT_PER_MINUTE: "0" })).toThrow(
    "RATE_LIMIT",
  );
  expect(
    parseRuntimeConfig({ ENVIRONMENT: "local", RATE_LIMIT_PER_MINUTE: "2" }),
  ).toMatchObject({ rateLimitPerMinute: 2 });
});

test("P3-03: 重连凭证为不可预测格式且 Cookie 不泄露到非 HttpOnly 配置", () => {
  const subjectId = createAnonymousSubjectId();
  const token = createReconnectToken();
  const cookie = reconnectCookie(
    { subjectId, token },
    parseRuntimeConfig({ ENVIRONMENT: "production" }),
  );
  expect(parseReconnectCookie(cookie)).toEqual({ subjectId, token });
  expect(cookie).toContain("HttpOnly");
  expect(cookie).toContain("Secure");
  expect(cookie).not.toContain("SameSite=None");
});

test("P3-03: 不允许以一个匿名身份访问另一身份的资源", () => {
  expect(() => assertSubjectAccess("subject-a", "subject-b")).toThrow(
    "subject_mismatch",
  );
  expect(() => assertSubjectAccess("subject-a", "subject-a")).not.toThrow();
});

test("P3-03: 日志脱敏不输出 token、seed 或手牌", () => {
  expect(
    redactLogFields({
      roomId: "room-1",
      subjectId: "anonymous-user",
      token: "secret",
      seed: "seed",
      handCards: ["S-A"],
    }),
  ).toEqual({
    roomId: "room-1",
    subjectId: "[REDACTED]",
    token: "[REDACTED]",
    seed: "[REDACTED]",
    handCards: "[REDACTED]",
  });
});
