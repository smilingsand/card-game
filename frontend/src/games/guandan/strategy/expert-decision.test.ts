import { expect, test } from "vitest";
import type { Card } from "../../../platform/types";
import { createBotView } from "../bot-view";
import { getCompleteLegalCandidates } from "../rule-complete-legal-actions";
import type { TurnState } from "../turns";
import {
  chooseTableBotAction,
  chooseTableHintAction,
  chooseTableStrategicDecision,
  type TableGame
} from "../table-controller";
import { createDefaultStrategyProfile } from "./decision-explanation";
import { chooseExpertBotDecision } from "./expert-decision";

const card = (id: string, rank: Card["rank"], suit: Card["suit"] = "spades"): Card => ({
  id,
  deckIndex: 0,
  rank,
  suit
});

const selfHand = [
  card("s3", "3"),
  card("s4", "4"),
  card("s5", "5"),
  card("s6", "6"),
  card("s7", "7")
];
const state: TurnState = {
  hands: { east: [], south: selfHand.map((item) => item.id), west: [], north: [] },
  current: "south",
  leader: "south",
  passes: 0,
  finished: []
};
const view = () =>
  createBotView({
    selfSeat: "south",
    leader: "south",
    levelRank: "2",
    hand: selfHand,
    publicEvents: [],
    remainingCardCounts: { east: 10, south: 5, west: 10, north: 10 },
    legalActions: getCompleteLegalCandidates({ state, selfHand, levelRank: "2" })
  });

test("expert 入口完整执行、可复现且不接受 normal 回退", () => {
  const first = chooseExpertBotDecision({
    view: view(),
    profile: createDefaultStrategyProfile("expert")
  });
  const second = chooseExpertBotDecision({
    view: view(),
    profile: createDefaultStrategyProfile("expert")
  });
  expect(first).toEqual(second);
  expect(first.explanation.profile).toMatchObject({ id: "expert", version: "p2.5a-1" });
  expect(first.debug?.candidateCount).toBe(view().legalActions.length);
  expect(first.explanation.candidates.some((candidate) => candidate.matchedRules.length > 0)).toBe(
    true
  );
  expect(() =>
    chooseExpertBotDecision({ view: view(), profile: createDefaultStrategyProfile("normal") })
  ).toThrow(/normal/);
  expect(() =>
    chooseExpertBotDecision({
      view: { ...view(), legalActions: [] },
      profile: createDefaultStrategyProfile("expert")
    })
  ).toThrow(/完整合法动作/);
});

test("experimental 与 expert 规则集隔离，且专家评分不是 normal 基线伪装", () => {
  const expert = chooseExpertBotDecision({
    view: view(),
    profile: createDefaultStrategyProfile("expert")
  });
  const experimental = chooseExpertBotDecision({
    view: view(),
    profile: createDefaultStrategyProfile("experimental")
  });
  expect(expert.explanation.candidates.some((candidate) => candidate.matchedRules.length > 0)).toBe(
    true
  );
  expect(
    experimental.explanation.candidates.every((candidate) => candidate.matchedRules.length === 0)
  ).toBe(true);
  expect(expert.explanation.candidates.some((candidate) => candidate.finalScore !== 0)).toBe(true);
});

test("牌桌 normal 保持 legacy，expert 的机器人与提示共用完整入口", () => {
  const game: TableGame = {
    cardsById: new Map(selfHand.map((item) => [item.id, item])),
    state,
    publicEvents: []
  };
  const normal = chooseTableStrategicDecision(game);
  const expert = chooseTableStrategicDecision(game, "expert");
  expect(normal?.explanation.profile.id).toBe("normal");
  expect(normal?.explanation.candidates).toHaveLength(1);
  expect(expert?.explanation.profile.id).toBe("expert");
  expect(expert?.explanation.candidates.length).toBe(view().legalActions.length);
  expect(chooseTableBotAction(game, "expert")).toEqual(expert?.selectedAction);
  expect(chooseTableHintAction(game, "expert")).toEqual(expert?.selectedAction);
});
