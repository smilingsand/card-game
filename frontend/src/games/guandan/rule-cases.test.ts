import { describe, expect, test } from "vitest";
import { GUANDAN_RULE_CASES, REQUIRED_RULE_IDS } from "./rule-cases";

describe("P1-05 掼蛋冻结规则测试矩阵", () => {
  test("每条冻结实现规则都有唯一、可执行且可追溯的固定牌例", () => {
    const caseIds = GUANDAN_RULE_CASES.map((ruleCase) => ruleCase.id);

    expect(caseIds).toEqual(REQUIRED_RULE_IDS);
    expect(new Set(caseIds)).toHaveLength(REQUIRED_RULE_IDS.length);
    for (const ruleCase of GUANDAN_RULE_CASES) {
      expect(ruleCase.input.length).toBeGreaterThan(0);
      expect(ruleCase.expected.length).toBeGreaterThan(0);
      expect(ruleCase.source).toMatch(
        /^(docs\/resolved-rules\.md#|proj-info\/adr\/ADR-\d{4}-[\w-]+\.md#)/
      );
    }
  });

  test("矩阵覆盖适用范围、牌型比较、回合结束、升级进贡和 P0 冻结决议", () => {
    const sections = new Set(GUANDAN_RULE_CASES.map((ruleCase) => ruleCase.section));

    expect(sections).toEqual(
      new Set(["适用范围", "牌型与比较", "回合与结束", "升级、进贡与抗贡", "P0 冻结决议"])
    );
  });
});
