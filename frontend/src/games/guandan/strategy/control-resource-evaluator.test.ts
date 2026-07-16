import { expect, test } from "vitest";
import type { Card } from "../../../platform/types";
import type { SituationAnalysis } from "./situation-analyzer";
import { analyzeHandStructure } from "./hand-structure-analyzer";
import type { PostActionHandEvaluation } from "./post-action-hand-evaluator";
import { evaluateControlResources } from "./control-resource-evaluator";

const card = (id: string, rank: Card["rank"], suit: Card["suit"]): Card => ({
  id,
  deckIndex: 0,
  rank,
  suit
});

const situation = (
  phase: SituationAnalysis["phase"],
  threat: "low" | "critical",
  teammateSprinting = false
) =>
  ({
    phase,
    opponentThreat: { level: threat },
    teammate: { isHolding: false, isSprinting: teammateSprinting }
  }) as SituationAnalysis;

const postAction = (remainingHand: readonly Card[], exceptions: readonly string[] = []) =>
  ({
    remainingHand,
    acceptableExceptions: exceptions,
    after: { lowSingleCount: remainingHand.length }
  }) as PostActionHandEvaluation;

test("中前期打掉最后控制资源且仍有多个低散单时，保留回收点预算并给出明确机会成本", () => {
  const hand = [
    card("joker", "big-joker", "joker"),
    card("low-3", "3", "spades"),
    card("low-4", "4", "clubs"),
    card("low-5", "5", "diamonds")
  ];
  const result = evaluateControlResources({
    action: { type: "play", actor: "east", cardIds: ["joker"], interpretation: undefined as never },
    structure: analyzeHandStructure(hand, "2"),
    situation: situation("middle", "low"),
    postAction: postAction(hand.slice(1)),
    levelRank: "2"
  });

  expect(result).toMatchObject({
    phase: "middle",
    spendsLastControlResource: true,
    preservesRecoveryPoint: false,
    exception: null
  });
  expect(result.budget.minimumReserveCount).toBe(1);
  expect(result.opportunityCost.reasons).toEqual(
    expect.arrayContaining(["spends_last_control_resource", "leaves_low_singles_without_recovery"])
  );
});

test("尾局直接出完与具备明确阻断证据的尾局，允许消耗控制资源作为可追溯例外", () => {
  const hand = [card("joker", "big-joker", "joker"), card("low-3", "3", "spades")];
  const structure = analyzeHandStructure(hand, "2");
  const action = {
    type: "play" as const,
    actor: "east" as const,
    cardIds: ["joker", "low-3"],
    interpretation: undefined as never
  };

  const directFinish = evaluateControlResources({
    action,
    structure,
    situation: situation("endgame", "low"),
    postAction: postAction([], []),
    levelRank: "2"
  });
  const endgameBlock = evaluateControlResources({
    action: { ...action, cardIds: ["joker"] },
    structure,
    situation: situation("endgame", "critical"),
    postAction: postAction([hand[1]], ["endgame_exception_requires_external_context"]),
    levelRank: "2"
  });

  expect(directFinish.exception).toBe("direct_finish");
  expect(endgameBlock.exception).toBe("endgame_block");
  expect(endgameBlock.opportunityCost.reasons).not.toContain("spends_last_control_resource");
});

test("仅在上游明确 team_support 标签且队友公开冲刺时，允许为队友救援消耗控制资源", () => {
  const hand = [card("joker", "big-joker", "joker"), card("low-3", "3", "spades")];
  const input = {
    action: {
      type: "play" as const,
      actor: "east" as const,
      cardIds: ["joker"],
      interpretation: undefined as never
    },
    structure: analyzeHandStructure(hand, "2"),
    levelRank: "2" as const
  };

  const approved = evaluateControlResources({
    ...input,
    situation: situation("endgame", "low", true),
    postAction: postAction([hand[1]], ["team_support_requires_external_context"])
  });
  const unapproved = evaluateControlResources({
    ...input,
    situation: situation("endgame", "low", true),
    postAction: postAction([hand[1]])
  });

  expect(approved.exception).toBe("team_support");
  expect(approved.opportunityCost.reasons).not.toContain("spends_last_control_resource");
  expect(unapproved.exception).toBeNull();
  expect(unapproved.opportunityCost.reasons).toContain("spends_last_control_resource");
});

test("资源清单覆盖王、级牌、红桃级牌、A、高对子/三张、炸弹和同花顺，且评估确定且不修改输入", () => {
  const hand = [
    card("big", "big-joker", "joker"),
    card("level-heart", "2", "hearts"),
    card("ace-1", "A", "spades"),
    card("ace-2", "A", "clubs"),
    card("ace-3", "A", "diamonds"),
    card("ace-4", "A", "hearts"),
    card("sf-a", "9", "spades"),
    card("sf-b", "10", "spades"),
    card("sf-c", "J", "spades"),
    card("sf-d", "Q", "spades"),
    card("sf-e", "K", "spades")
  ];
  const input = {
    action: { type: "pass" as const, actor: "east" as const },
    structure: analyzeHandStructure(hand, "2"),
    situation: situation("opening", "low"),
    postAction: postAction(hand),
    levelRank: "2" as const
  };
  const before = structuredClone(input);
  const first = evaluateControlResources(input);

  expect(first).toEqual(evaluateControlResources(input));
  expect(input).toEqual(before);
  expect(first.before.jokers.count).toBeGreaterThan(0);
  expect(first.before.levelCards.count).toBeGreaterThan(0);
  expect(first.before.wildcardLevelCards.count).toBeGreaterThan(0);
  expect(first.before.aces.count).toBeGreaterThan(0);
  expect(first.before.highPairs.count).toBeGreaterThan(0);
  expect(first.before.highTriples.count).toBeGreaterThan(0);
  expect(first.before.bombs.count).toBeGreaterThan(0);
  expect(first.before.straightFlushes.count).toBeGreaterThan(0);
});
