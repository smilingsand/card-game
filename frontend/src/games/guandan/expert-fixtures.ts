import type { Card, Rank, Seat, Suit } from "../../platform/types";

/**
 * P2.5 专家固定牌例契约（schemaVersion 1）。
 *
 * 本文件是策略实现前的机器可读基线，不调用机器人，也不把对手隐藏手牌
 * 放入 fixture。`cardIndexes` 永远引用 `selfHand` 中的实体牌，而不是牌面。
 * 后续 runner 必须先把 proposed action 交给规则引擎验证，再比较断言。
 */
export const EXPERT_FIXTURE_SCHEMA_VERSION = 1 as const;
export type ExpertFixtureId = `S${number}`;
export type EvidenceLevel =
  "rules_based" | "expert_source" | "heuristic" | "needs_expert_validation";
export type StrategyMaturity = "default_eligible" | "experimental";
export type FixtureAction = {
  readonly label: string;
  readonly kind: "play" | "pass";
  readonly pattern: string;
  readonly cardIndexes: readonly number[];
};
/** 候选生成必须产生并交由规则引擎验证的候选，不代表最终选牌。 */
export type CandidateExpectation = {
  readonly label: string;
  readonly pattern: string;
  readonly cardIndexes: readonly number[];
};
export type PublicSituation = {
  readonly selfSeat: Seat;
  readonly leader: Seat;
  readonly highestSeat?: Seat;
  /** 仅公开的已出/过牌摘要；不是其他玩家手牌。 */
  readonly publicEvents: readonly {
    readonly sequence: number;
    readonly type: string;
    readonly actor: Seat;
    readonly detail: string;
  }[];
  readonly remainingCardCounts: Readonly<Record<Seat, number>>;
  readonly currentTarget: string;
  readonly legalContext: "lead" | "follow";
};
export type ExpertFixture = {
  readonly schemaVersion: typeof EXPERT_FIXTURE_SCHEMA_VERSION;
  readonly id: ExpertFixtureId;
  readonly title: string;
  readonly levelRank: Exclude<Rank, "small-joker" | "big-joker">;
  readonly selfHand: readonly Card[];
  readonly publicSituation: PublicSituation;
  readonly recommended: FixtureAction;
  readonly rejected: readonly FixtureAction[];
  readonly allowedAlternatives: readonly FixtureAction[];
  readonly candidateExpectations: readonly CandidateExpectation[];
  /** 实现后的各模块必须能够回答的断言，不是当前 basic bot 的期望。 */
  readonly assertions: {
    readonly structure: readonly string[];
    readonly postAction: readonly string[];
    readonly control: readonly string[];
    readonly contest: readonly string[];
    readonly followUp: readonly string[];
    readonly explanation: readonly string[];
  };
  readonly coverage: readonly string[];
  readonly evidence: EvidenceLevel;
  readonly maturity: StrategyMaturity;
  readonly exception: "normal" | "endgame_block" | "direct_finish" | "team_support";
};

type CardSpec = `${Rank}:${Exclude<Suit, "joker">}` | "small-joker:joker" | "big-joker:joker";
const card = (id: string, spec: CardSpec, deckIndex: number): Card => {
  const [rank, suit] = spec.split(":") as [Rank, Suit];
  return { id, deckIndex, rank, suit };
};
const action = (label: string, pattern: string, ...cardIndexes: number[]): FixtureAction => ({
  label,
  kind: label === "pass" ? "pass" : "play",
  pattern,
  cardIndexes
});
const standardAssertions = (note: string) => ({
  structure: ["实体牌归属与 natural/wildcard_completed/split 来源可区分", note],
  postAction: ["比较预计总手数、完整组合、低散单、控制牌与 deadHandRisk"],
  control: ["计算控制资源机会成本及尾局例外"],
  contest: ["比较对手威胁、队友需要、结构成本和压住收益"],
  followUp: ["输出至少一手领出路线或 noUsefulFollowUp"],
  explanation: ["包含命中规则、evidence、例外和拒绝原因"]
});
const scenario = (
  input: Omit<
    ExpertFixture,
    "schemaVersion" | "selfHand" | "assertions" | "candidateExpectations"
  > & {
    readonly hand: readonly CardSpec[];
    readonly note: string;
    readonly candidateExpectations?: readonly CandidateExpectation[];
  }
): ExpertFixture => ({
  ...input,
  schemaVersion: EXPERT_FIXTURE_SCHEMA_VERSION,
  selfHand: (() => {
    const seen = new Map<CardSpec, number>();
    return input.hand.map((spec, index) => {
      const deckIndex = seen.get(spec) ?? 0;
      seen.set(spec, deckIndex + 1);
      return card(`${input.id.toLowerCase()}-${index}`, spec, deckIndex);
    });
  })(),
  candidateExpectations: input.candidateExpectations ?? [],
  assertions: standardAssertions(input.note)
});

const s = (
  id: ExpertFixtureId,
  title: string,
  hand: readonly CardSpec[],
  levelRank: ExpertFixture["levelRank"],
  legalContext: "lead" | "follow",
  target: string,
  recommended: FixtureAction,
  rejected: readonly FixtureAction[],
  coverage: readonly string[],
  exception: ExpertFixture["exception"] = "normal",
  highestSeat: Seat | undefined = legalContext === "follow" ? "south" : undefined,
  candidateExpectations: readonly CandidateExpectation[] = []
): ExpertFixture =>
  scenario({
    id,
    title,
    hand,
    levelRank,
    recommended,
    rejected,
    candidateExpectations,
    // 仅在跟牌时过牌才可能是合法备选；领出时 fixture 明确无该备选。
    allowedAlternatives:
      legalContext === "follow" && recommended.kind !== "pass" ? [action("pass", "pass")] : [],
    coverage,
    exception,
    evidence: "expert_source",
    maturity: "default_eligible",
    note: title,
    publicSituation: {
      selfSeat: "east",
      leader: legalContext === "lead" ? "east" : "south",
      highestSeat,
      legalContext,
      currentTarget: target,
      publicEvents: [
        {
          sequence: 1,
          type: legalContext === "lead" ? "turn_started" : "play",
          actor: legalContext === "lead" ? "east" : "south",
          detail: target
        }
      ],
      remainingCardCounts: {
        east: hand.length,
        south: exception === "endgame_block" ? 1 : 9,
        west: 8,
        north: 10
      }
    }
  });

/** P2.5A 的 S01-S50；每例均有完整己方实体手牌和仅公开局面。 */
export const EXPERT_SCENARIOS: readonly ExpertFixture[] = [
  s(
    "S01",
    "自然对J/Q优先于逢人配对6",
    ["J:spades", "J:clubs", "Q:spades", "Q:clubs", "2:hearts", "6:spades", "6:clubs", "3:diamonds"],
    "2",
    "follow",
    "对5",
    action("自然对J", "pair", 0, 1),
    [action("红桃级牌补对6", "pair", 4, 5)],
    ["natural_pair_priority", "wildcard_opportunity_cost"]
  ),
  s(
    "S02",
    "自然对J优先于单逢人配对6",
    ["J:spades", "J:clubs", "2:hearts", "6:spades", "7:clubs", "8:diamonds"],
    "2",
    "follow",
    "对5",
    action("自然对J", "pair", 0, 1),
    [action("逢人配补对6", "pair", 2, 3)],
    ["natural_pair_priority", "wildcard_opportunity_cost"]
  ),
  s(
    "S03",
    "天然8888不制造5555",
    [
      "8:spades",
      "8:hearts",
      "8:diamonds",
      "8:clubs",
      "2:hearts",
      "2:hearts",
      "5:spades",
      "5:clubs",
      "A:spades"
    ],
    "2",
    "lead",
    "领出",
    action("保留结构领出55", "pair", 6, 7),
    [action("两逢人配制造5555", "bomb-4", 4, 5, 6, 7)],
    ["natural_bomb_protection", "wildcard_low_value"]
  ),
  s(
    "S04",
    "有天然炸弹时不造更小炸弹",
    [
      "8:spades",
      "8:hearts",
      "8:diamonds",
      "8:clubs",
      "2:hearts",
      "5:spades",
      "5:clubs",
      "K:spades"
    ],
    "2",
    "follow",
    "普通三张",
    action("pass", "pass"),
    [action("逢人配5555", "bomb-4", 4, 5, 6)],
    ["natural_bomb_protection", "wildcard_low_value"]
  ),
  s(
    "S05",
    "逢人配对子阻止两张对手",
    ["2:hearts", "6:spades", "J:spades", "J:clubs", "A:clubs"],
    "2",
    "follow",
    "对5，对手2张",
    action("逢人配对6阻断", "pair", 0, 1),
    [action("pass", "pass")],
    ["wildcard_opportunity_cost", "endgame_exception"],
    "endgame_block"
  ),
  s(
    "S06",
    "逢人配优先补顺子",
    ["2:hearts", "5:spades", "6:clubs", "7:diamonds", "8:spades", "9:clubs", "J:spades"],
    "2",
    "lead",
    "领出",
    action("补顺子5-9", "straight", 0, 1, 2, 3, 4),
    [action("补低对子", "pair", 0, 1)],
    ["hand_plan", "wildcard_opportunity_cost"]
  ),
  s(
    "S07",
    "逢人配优先完整钢板",
    ["2:hearts", "2:hearts", "7:spades", "7:clubs", "7:diamonds", "8:spades", "8:clubs", "K:clubs"],
    "2",
    "lead",
    "领出",
    action("完整钢板", "steel-plate", 0, 1, 2, 3, 4, 5),
    [action("低四炸", "bomb-4", 0, 1, 2, 3)],
    ["hand_plan", "wildcard_low_value"]
  ),
  s(
    "S08",
    "红桃级牌不低配",
    ["2:hearts", "A:spades", "A:clubs", "K:spades", "Q:clubs", "5:diamonds"],
    "2",
    "follow",
    "单K",
    action("红桃级牌自然压制", "single", 0),
    [action("低配为6", "single", 0)],
    ["control_budget", "wildcard_opportunity_cost"]
  ),
  s(
    "S09",
    "逢人配直接走完",
    ["2:hearts", "6:spades"],
    "2",
    "lead",
    "领出只剩两张",
    action("逢人配对6走完", "pair", 0, 1),
    [action("单6", "single", 1)],
    ["direct_finish", "wildcard_opportunity_cost"],
    "direct_finish"
  ),
  s(
    "S10",
    "两逢人配阻断一张对手",
    ["2:hearts", "2:hearts", "5:spades", "5:clubs", "J:spades"],
    "2",
    "follow",
    "对4，对手1张",
    action("5555阻断", "bomb-4", 0, 1, 2, 3),
    [action("pass", "pass")],
    ["endgame_exception", "wildcard_opportunity_cost"],
    "endgame_block"
  ),
  s(
    "S11",
    "普通局面不拆8888压单5",
    ["8:spades", "8:hearts", "8:diamonds", "8:clubs", "3:spades", "J:clubs"],
    "2",
    "follow",
    "单5",
    action("pass", "pass"),
    [action("拆8888出8", "single", 0)],
    ["natural_bomb_protection", "meaningless_contest"]
  ),
  s(
    "S12",
    "一张对手时允许拆8888",
    ["8:spades", "8:hearts", "8:diamonds", "8:clubs", "3:spades"],
    "2",
    "follow",
    "单5，对手1张",
    action("拆8阻断", "single", 0),
    [action("pass", "pass")],
    ["natural_bomb_protection", "endgame_exception"],
    "endgame_block"
  ),
  s(
    "S13",
    "不拆自然顺子",
    ["5:spades", "6:clubs", "7:diamonds", "8:spades", "9:clubs", "J:spades"],
    "2",
    "follow",
    "单6",
    action("独立J", "single", 5),
    [action("拆顺子7", "single", 2)],
    ["structure_protection", "dead_hand_risk"]
  ),
  s(
    "S14",
    "不拆三连对",
    ["6:spades", "6:clubs", "7:spades", "7:clubs", "8:spades", "8:clubs", "J:diamonds"],
    "2",
    "follow",
    "对5",
    action("pass", "pass"),
    [action("拆三连对6", "pair", 0, 1)],
    ["structure_protection", "meaningless_contest"]
  ),
  s(
    "S15",
    "不拆钢板",
    ["7:spades", "7:clubs", "7:diamonds", "8:spades", "8:clubs", "8:diamonds", "K:spades"],
    "2",
    "follow",
    "三张6",
    action("pass", "pass"),
    [action("拆钢板7", "triple", 0, 1, 2)],
    ["structure_protection", "meaningless_contest"]
  ),
  s(
    "S16",
    "三带二附属对子避免死张",
    ["6:spades", "6:clubs", "6:diamonds", "4:spades", "4:clubs", "J:spades", "J:clubs"],
    "2",
    "lead",
    "领出",
    action("保留J对子", "three-with-pair", 0, 1, 2, 3, 4),
    [action("拆J对子作附属", "three-with-pair", 0, 1, 2, 5, 6)],
    ["post_action_hand", "dead_hand_risk"]
  ),
  s(
    "S17",
    "拆弱对消除低散单",
    ["3:spades", "3:clubs", "4:diamonds", "5:spades", "6:clubs", "7:diamonds"],
    "2",
    "lead",
    "领出",
    action("拆3对成顺子", "straight", 0, 2, 3, 4, 5),
    [action("保留弱对子", "pair", 0, 1)],
    ["post_action_hand", "dead_hand_risk"]
  ),
  s(
    "S18",
    "即时相同选择低死手风险",
    ["3:spades", "4:clubs", "5:diamonds", "6:spades", "6:clubs", "J:spades"],
    "2",
    "follow",
    "单5",
    action("出J", "single", 5),
    [action("拆6对子", "single", 3)],
    ["post_action_hand", "dead_hand_risk"]
  ),
  s(
    "S19",
    "按动作后预计手数决策",
    ["3:spades", "4:clubs", "5:diamonds", "6:spades", "7:clubs", "8:diamonds", "J:spades"],
    "2",
    "lead",
    "领出",
    action("顺子3-7", "straight", 0, 1, 2, 3, 4),
    [action("单J", "single", 6)],
    ["post_action_hand", "hand_plan"]
  ),
  s(
    "S20",
    "完整出完性胜过单纯保炸",
    [
      "8:spades",
      "8:hearts",
      "8:diamonds",
      "8:clubs",
      "3:spades",
      "4:clubs",
      "5:diamonds",
      "6:spades",
      "7:clubs"
    ],
    "2",
    "lead",
    "领出",
    action("顺子3-7", "straight", 4, 5, 6, 7, 8),
    [action("保炸出单3", "single", 4)],
    ["finishability", "dead_hand_risk"]
  ),
  s(
    "S21",
    "多低散牌时保留最后王",
    [
      "big-joker:joker",
      "2:hearts",
      "3:spades",
      "4:clubs",
      "5:diamonds",
      "6:spades",
      "7:clubs",
      "J:spades"
    ],
    "2",
    "follow",
    "单A",
    action("pass", "pass"),
    [action("大王压制", "single", 0)],
    ["control_budget", "low_singles"]
  ),
  s(
    "S22",
    "控制牌耗尽惩罚",
    ["2:hearts", "A:spades", "A:clubs", "K:spades", "3:clubs", "4:diamonds", "5:spades"],
    "2",
    "follow",
    "单Q",
    action("K压制", "single", 3),
    [action("红桃级牌压制", "single", 0)],
    ["control_budget", "low_singles"]
  ),
  s(
    "S23",
    "高对子保留回收",
    ["A:spades", "A:clubs", "3:spades", "4:clubs", "5:diamonds", "6:spades"],
    "2",
    "follow",
    "对K",
    action("pass", "pass"),
    [action("对A压制", "pair", 0, 1)],
    ["control_budget", "recovery"]
  ),
  s(
    "S24",
    "低威胁不滥用王",
    ["small-joker:joker", "big-joker:joker", "3:spades", "4:clubs", "5:diamonds", "6:spades"],
    "2",
    "follow",
    "单8",
    action("pass", "pass"),
    [action("小王压制", "single", 0), action("大王压制", "single", 1)],
    ["control_budget", "meaningless_contest"]
  ),
  s(
    "S25",
    "高对子无后续允许过牌",
    ["Q:spades", "Q:clubs", "3:spades", "4:clubs", "5:diamonds"],
    "2",
    "follow",
    "对J",
    action("pass", "pass"),
    [action("对Q压制", "pair", 0, 1)],
    ["control_budget", "no_useful_follow_up"]
  ),
  s(
    "S26",
    "唯一炸弹保留",
    [
      "9:spades",
      "9:hearts",
      "9:diamonds",
      "9:clubs",
      "3:spades",
      "4:clubs",
      "5:diamonds",
      "6:spades"
    ],
    "2",
    "follow",
    "普通三张",
    action("pass", "pass"),
    [action("炸弹争夺", "bomb-4", 0, 1, 2, 3)],
    ["control_budget", "natural_bomb_protection"]
  ),
  s(
    "S27",
    "控制换两手出完路线",
    ["big-joker:joker", "A:spades", "A:clubs", "6:spades", "6:clubs"],
    "2",
    "follow",
    "单K",
    action("大王取得牌权", "single", 0),
    [action("pass", "pass")],
    ["control_budget", "follow_up"],
    "direct_finish"
  ),
  s(
    "S28",
    "为队友送牌可用控制",
    ["2:hearts", "A:spades", "A:clubs", "6:spades", "6:clubs"],
    "2",
    "follow",
    "对K，队友2张",
    action("对A接管送对6", "pair", 1, 2),
    [action("pass", "pass")],
    ["team_support", "control_budget"],
    "team_support"
  ),
  s(
    "S29",
    "最后控制阻断",
    ["big-joker:joker", "3:spades", "4:clubs", "5:diamonds"],
    "2",
    "follow",
    "单A，对手1张",
    action("大王阻断", "single", 0),
    [action("pass", "pass")],
    ["endgame_exception", "control_budget"],
    "endgame_block"
  ),
  s(
    "S30",
    "保留回收牌",
    ["A:spades", "A:clubs", "K:spades", "3:clubs", "4:diamonds"],
    "2",
    "follow",
    "单Q",
    action("K压制", "single", 2),
    [action("拆对A", "single", 0)],
    ["recovery", "control_budget"]
  ),
  s(
    "S31",
    "低威胁高成本争夺过牌",
    ["8:spades", "8:hearts", "8:diamonds", "8:clubs", "3:spades"],
    "2",
    "follow",
    "单5",
    action("pass", "pass"),
    [action("拆炸8", "single", 0)],
    ["meaningless_contest", "natural_bomb_protection"]
  ),
  s(
    "S32",
    "最后控制牌不争低威胁",
    ["big-joker:joker", "3:spades", "4:clubs", "5:diamonds"],
    "2",
    "follow",
    "单9",
    action("pass", "pass"),
    [action("大王压制", "single", 0)],
    ["meaningless_contest", "control_budget"]
  ),
  s(
    "S33",
    "低成本且有路线可以争夺",
    ["K:spades", "6:spades", "6:clubs", "7:spades", "7:clubs"],
    "2",
    "follow",
    "单Q",
    action("K压制", "single", 0),
    [action("pass", "pass")],
    ["contest_value", "follow_up"]
  ),
  s(
    "S34",
    "一张对手优先阻断",
    ["8:spades", "8:hearts", "8:diamonds", "8:clubs", "3:spades"],
    "2",
    "follow",
    "单5，对手1张",
    action("拆8阻断", "single", 0),
    [action("pass", "pass")],
    ["endgame_exception", "contest_value"],
    "endgame_block"
  ),
  s(
    "S35",
    "公开对子倾向提高阻断",
    ["J:spades", "J:clubs", "3:spades", "4:clubs"],
    "2",
    "follow",
    "对10，对手2张",
    action("对J阻断", "pair", 0, 1),
    [action("pass", "pass")],
    ["public_memory", "contest_value"],
    "endgame_block"
  ),
  s(
    "S36",
    "队友压住不接牌",
    ["A:spades", "A:clubs", "3:spades", "4:clubs"],
    "2",
    "follow",
    "队友对K",
    action("pass", "pass"),
    [action("对A接管", "pair", 0, 1)],
    ["team_support", "meaningless_contest"]
  ),
  s(
    "S37",
    "队友不安全时允许接管",
    ["A:spades", "A:clubs", "3:spades", "4:clubs"],
    "2",
    "follow",
    "队友对K，下一对手1张",
    action("对A接管", "pair", 0, 1),
    [action("pass", "pass")],
    ["team_support", "endgame_exception"],
    "team_support"
  ),
  s(
    "S38",
    "争夺增加死手风险则过牌",
    ["6:spades", "6:clubs", "7:spades", "7:clubs", "8:spades", "8:clubs", "3:diamonds"],
    "2",
    "follow",
    "对5",
    action("pass", "pass"),
    [action("拆三连对6", "pair", 0, 1)],
    ["dead_hand_risk", "meaningless_contest"]
  ),
  s(
    "S39",
    "压住后能领顺子者优先",
    ["K:spades", "A:clubs", "5:spades", "6:clubs", "7:diamonds", "8:spades", "9:clubs"],
    "2",
    "follow",
    "单Q",
    action("K压后领顺", "single", 0),
    [action("A压后无路线", "single", 1)],
    ["follow_up", "route_quality"]
  ),
  s(
    "S40",
    "无安全下一手允许过牌",
    ["A:spades", "3:clubs", "4:diamonds", "5:spades"],
    "2",
    "follow",
    "单K",
    action("pass", "pass"),
    [action("A压制", "single", 0)],
    ["no_useful_follow_up", "meaningless_contest"]
  ),
  s(
    "S41",
    "连续三连对出完路线",
    ["K:spades", "6:spades", "6:clubs", "7:spades", "7:clubs", "8:spades", "8:clubs"],
    "2",
    "follow",
    "单Q",
    action("K取得牌权", "single", 0),
    [action("pass", "pass")],
    ["follow_up", "direct_finish"]
  ),
  s(
    "S42",
    "压住无路线降权",
    ["A:spades", "3:clubs", "5:diamonds", "7:spades"],
    "2",
    "follow",
    "单K",
    action("pass", "pass"),
    [action("A压制", "single", 0)],
    ["no_useful_follow_up", "follow_up"]
  ),
  s(
    "S43",
    "当前少出但路线更优",
    ["K:spades", "5:spades", "6:clubs", "7:diamonds", "8:spades", "9:clubs"],
    "2",
    "follow",
    "单Q",
    action("K后领顺", "single", 0),
    [action("顺子即时领出", "straight", 1, 2, 3, 4, 5)],
    ["follow_up", "post_action_hand"]
  ),
  s(
    "S44",
    "不破坏唯一回收路线",
    ["5:spades", "6:clubs", "7:diamonds", "8:spades", "9:clubs", "J:spades"],
    "2",
    "lead",
    "领出",
    action("单J", "single", 5),
    [action("顺子多出", "straight", 0, 1, 2, 3, 4)],
    ["follow_up", "recovery"]
  ),
  s(
    "S45",
    "同手数选择资源健康计划",
    ["A:spades", "A:clubs", "8:spades", "8:hearts", "8:diamonds", "8:clubs", "3:spades"],
    "2",
    "lead",
    "领出",
    action("保留A对子", "bomb-4", 2, 3, 4, 5),
    [action("拆A对子", "pair", 0, 1)],
    ["hand_plan", "control_budget"]
  ),
  s(
    "S46",
    "尾局明确连续出完",
    ["6:spades", "6:clubs", "K:spades"],
    "2",
    "lead",
    "领出",
    action("先对6", "pair", 0, 1),
    [action("先单K", "single", 2)],
    ["follow_up", "direct_finish"],
    "direct_finish"
  ),
  s(
    "S47",
    "候选覆盖三连对钢板顺子",
    [
      "5:spades",
      "5:clubs",
      "6:spades",
      "6:clubs",
      "7:spades",
      "7:clubs",
      "7:diamonds",
      "8:spades",
      "8:clubs",
      "8:diamonds",
      "9:spades",
      "9:clubs"
    ],
    "2",
    "lead",
    "领出",
    action("三连对", "three-consecutive-pairs", 0, 1, 2, 3, 4, 5),
    [action("仅枚举单张", "single", 0)],
    ["candidate_coverage", "three_consecutive_pairs", "steel_plate", "straight"],
    "normal",
    undefined,
    [
      { label: "三连对5-7", pattern: "three-consecutive-pairs", cardIndexes: [0, 1, 2, 3, 4, 5] },
      { label: "钢板7-8", pattern: "steel-plate", cardIndexes: [4, 5, 6, 7, 8, 9] },
      { label: "顺子5-9", pattern: "straight", cardIndexes: [0, 2, 4, 7, 10] }
    ]
  ),
  s(
    "S48",
    "候选覆盖逢人配同花顺四王炸",
    [
      "small-joker:joker",
      "small-joker:joker",
      "big-joker:joker",
      "big-joker:joker",
      "2:hearts",
      "5:spades",
      "6:spades",
      "7:spades",
      "8:spades",
      "9:spades"
    ],
    "2",
    "lead",
    "领出",
    action("四王炸", "joker-bomb", 0, 1, 2, 3),
    [action("红桃级牌低配单张", "single", 4)],
    ["candidate_coverage", "wildcard_combo", "straight_flush", "joker_bomb"],
    "normal",
    undefined,
    [
      { label: "红桃级牌补对5", pattern: "pair", cardIndexes: [4, 5] },
      { label: "同花顺5-9", pattern: "straight-flush", cardIndexes: [5, 6, 7, 8, 9] },
      { label: "四王炸", pattern: "joker-bomb", cardIndexes: [0, 1, 2, 3] }
    ]
  ),
  s(
    "S49",
    "公开记牌改变高单安全度",
    ["A:spades", "3:clubs", "4:diamonds", "5:spades"],
    "2",
    "follow",
    "单K，公开王已出",
    action("A压制", "single", 0),
    [action("pass", "pass")],
    ["public_memory", "contest_value"]
  ),
  s(
    "S50",
    "队友两张对子倾向送牌",
    ["6:spades", "6:clubs", "A:spades", "3:clubs"],
    "2",
    "lead",
    "队友2张且倾向对子",
    action("领对6送牌", "pair", 0, 1),
    [action("单A夺权", "single", 2)],
    ["team_support", "public_memory"]
  )
];

const requiredCoverage = [
  "natural_pair_priority",
  "natural_bomb_protection",
  "wildcard_opportunity_cost",
  "wildcard_low_value",
  "dead_hand_risk",
  "control_budget",
  "low_singles",
  "meaningless_contest",
  "follow_up",
  "endgame_exception",
  "team_support",
  "candidate_coverage",
  "public_memory"
] as const;
/** 供 P2.5-03 自检与后续 fixture runner 重用的静态契约检查。 */
export function validateExpertFixtures(
  fixtures: readonly ExpertFixture[] = EXPERT_SCENARIOS
): readonly string[] {
  const errors: string[] = [];
  if (fixtures.length < 50) errors.push("P2.5A 至少需要 50 个固定牌例");
  if (new Set(fixtures.map(({ id }) => id)).size !== fixtures.length)
    errors.push("场景 ID 必须唯一");
  for (const fixture of fixtures) {
    if (fixture.schemaVersion !== EXPERT_FIXTURE_SCHEMA_VERSION)
      errors.push(`${fixture.id}: schemaVersion 不匹配`);
    if (fixture.selfHand.length === 0) errors.push(`${fixture.id}: 缺少完整己方手牌`);
    if (new Set(fixture.selfHand.map(({ id }) => id)).size !== fixture.selfHand.length)
      errors.push(`${fixture.id}: 实体牌 ID 重复`);
    for (const candidate of [
      fixture.recommended,
      ...fixture.rejected,
      ...fixture.allowedAlternatives,
      ...fixture.candidateExpectations
    ])
      if (candidate.cardIndexes.some((index) => index < 0 || index >= fixture.selfHand.length))
        errors.push(`${fixture.id}: 动作引用越界实体牌`);
    if (
      fixture.coverage.includes("candidate_coverage") &&
      fixture.candidateExpectations.length === 0
    )
      errors.push(`${fixture.id}: 候选覆盖场景缺少 candidateExpectations`);
  }
  for (const coverage of requiredCoverage)
    if (!fixtures.some((fixture) => fixture.coverage.includes(coverage)))
      errors.push(`缺少覆盖: ${coverage}`);
  return errors;
}
