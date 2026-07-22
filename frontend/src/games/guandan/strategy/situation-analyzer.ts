import type { Event, Seat } from "../../../platform/types";
import type { BotView } from "../bot-view";
import type { PatternType } from "../patterns";

const SEATS: readonly Seat[] = ["east", "south", "west", "north"];
const teammateOf: Readonly<Record<Seat, Seat>> = {
  east: "west",
  west: "east",
  south: "north",
  north: "south"
};

export type SituationPhase = "opening" | "middle" | "endgame";
export type SituationRole = "attack" | "support" | "neutral";
export type ThreatLevel = "low" | "medium" | "high" | "critical";
export type EvidenceKind = "fact" | "inference";

export interface SituationEvidence {
  readonly kind: EvidenceKind;
  readonly confidence: number;
  readonly reason: string;
}

export interface PlayerTendency {
  readonly seat: Seat;
  readonly kind: "aggressive" | "conservative" | "unknown";
  readonly confidence: number;
  readonly evidence: readonly SituationEvidence[];
}

export interface SituationAnalysis {
  readonly fingerprint: string;
  /** 最后一个被消费的公开事件序号；没有可解析公开动作时为 0。 */
  readonly publicEventSequence: number;
  readonly phase: SituationPhase;
  readonly publicCards: {
    readonly totalActions: number;
    readonly playCount: number;
    readonly passCount: number;
    readonly patternCounts: Readonly<Partial<Record<PatternType, number>>>;
    /** 只根据 action.interpretation.comparisonKey 判断，不反推任何未公开牌面。 */
    readonly highComparisonPlayCount: number;
    readonly controlPatternPlayCount: number;
  };
  readonly playerTendencies: readonly PlayerTendency[];
  readonly opponentThreat: {
    readonly level: ThreatLevel;
    readonly immediateFinishSeats: readonly Seat[];
    readonly reasons: readonly SituationEvidence[];
  };
  readonly teammate: {
    readonly seat: Seat;
    readonly remainingCards: number;
    readonly isHolding: boolean;
    readonly isSprinting: boolean;
    readonly reasons: readonly SituationEvidence[];
  };
  readonly role: {
    readonly kind: SituationRole;
    readonly confidence: number;
    readonly reason: string;
  };
  /** 确定事实与概率推断显式分开，供后续评分解释复用。 */
  readonly reasoning: readonly SituationEvidence[];
}

type PublicAction =
  | { readonly sequence: number; readonly actor: Seat; readonly type: "pass" }
  | {
      readonly sequence: number;
      readonly actor: Seat;
      readonly type: "play";
      readonly pattern: PatternType;
      readonly comparisonKey: readonly number[];
    };

const patternOrder = (value: PatternType): number =>
  [
    "single",
    "pair",
    "triple",
    "three-with-pair",
    "three-consecutive-pairs",
    "steel-plate",
    "straight",
    "normal-bomb",
    "straight-flush",
    "four-jokers"
  ].indexOf(value);
const isSeat = (value: unknown): value is Seat =>
  typeof value === "string" && SEATS.includes(value as Seat);
const isPatternType = (value: unknown): value is PatternType =>
  patternOrder(value as PatternType) >= 0;
const cap = (value: number) => Math.max(0, Math.min(1, value));

/** 只解析桌面实际写入的 action.applied；未知事件与不完整 payload 均安全忽略。 */
function parsePublicAction(event: Event): PublicAction | undefined {
  if (
    event.type !== "action.applied" ||
    typeof event.payload !== "object" ||
    event.payload === null
  )
    return undefined;
  const action = (event.payload as { readonly action?: unknown }).action;
  if (typeof action !== "object" || action === null) return undefined;
  const candidate = action as {
    readonly type?: unknown;
    readonly actor?: unknown;
    readonly interpretation?: { readonly type?: unknown; readonly comparisonKey?: unknown };
  };
  if (!isSeat(candidate.actor)) return undefined;
  if (candidate.type === "pass")
    return { sequence: event.sequence, actor: candidate.actor, type: "pass" };
  if (
    candidate.type !== "play" ||
    !isPatternType(candidate.interpretation?.type) ||
    !Array.isArray(candidate.interpretation.comparisonKey) ||
    !candidate.interpretation.comparisonKey.every((item) => typeof item === "number")
  )
    return undefined;
  return {
    sequence: event.sequence,
    actor: candidate.actor,
    type: "play",
    pattern: candidate.interpretation.type,
    comparisonKey: candidate.interpretation.comparisonKey
  };
}

function canonicalActions(events: readonly Event[]): readonly PublicAction[] {
  return events
    .map(parsePublicAction)
    .filter((event): event is PublicAction => event !== undefined)
    .sort((left, right) => {
      const type = left.type.localeCompare(right.type);
      const details =
        left.type === "play" && right.type === "play"
          ? patternOrder(left.pattern) - patternOrder(right.pattern) ||
            left.comparisonKey.join(",").localeCompare(right.comparisonKey.join(","))
          : 0;
      return (
        left.sequence - right.sequence || left.actor.localeCompare(right.actor) || type || details
      );
    });
}

function publicCardSummary(actions: readonly PublicAction[]): SituationAnalysis["publicCards"] {
  const patternCounts: Partial<Record<PatternType, number>> = {};
  let playCount = 0;
  let passCount = 0;
  let highComparisonPlayCount = 0;
  let controlPatternPlayCount = 0;
  for (const action of actions) {
    if (action.type === "pass") {
      passCount += 1;
      continue;
    }
    playCount += 1;
    patternCounts[action.pattern] = (patternCounts[action.pattern] ?? 0) + 1;
    if ((action.comparisonKey.at(-1) ?? 0) >= 14) highComparisonPlayCount += 1;
    if (["normal-bomb", "straight-flush", "four-jokers"].includes(action.pattern))
      controlPatternPlayCount += 1;
  }
  return {
    totalActions: actions.length,
    playCount,
    passCount,
    patternCounts,
    highComparisonPlayCount,
    controlPatternPlayCount
  };
}

function tendencyFor(seat: Seat, actions: readonly PublicAction[]): PlayerTendency {
  const own = actions.filter((item) => item.actor === seat);
  if (own.length === 0) return { seat, kind: "unknown", confidence: 0, evidence: [] };
  const plays = own.filter(
    (item): item is Extract<PublicAction, { readonly type: "play" }> => item.type === "play"
  );
  const passes = own.filter((item) => item.type === "pass").length;
  const forceful = plays.filter(
    (item) =>
      ["normal-bomb", "straight-flush", "four-jokers"].includes(item.pattern) ||
      (item.comparisonKey.at(-1) ?? 0) >= 14
  ).length;
  const evidence: SituationEvidence[] = [];
  if (forceful > 0)
    evidence.push({
      kind: "fact",
      confidence: 1,
      reason: `公开记录有 ${forceful} 次高位或控制牌型出牌`
    });
  if (passes > 0)
    evidence.push({
      kind: "inference",
      confidence: cap(0.15 + passes * 0.08),
      reason: `公开记录有 ${passes} 次过牌，仅作为保守倾向的概率证据，不表示无牌`
    });
  const aggressiveScore = forceful / own.length;
  const conservativeScore = passes / own.length;
  const kind =
    aggressiveScore > conservativeScore && forceful > 0
      ? "aggressive"
      : conservativeScore > aggressiveScore
        ? "conservative"
        : "unknown";
  return {
    seat,
    kind,
    confidence:
      kind === "unknown" ? 0 : cap(0.2 + Math.max(aggressiveScore, conservativeScore) * 0.6),
    evidence
  };
}

function phaseFor(counts: Readonly<Record<Seat, number>>): SituationPhase {
  const all = SEATS.map((seat) => counts[seat]);
  if (all.some((count) => count <= 3)) return "endgame";
  const total = all.reduce((sum, count) => sum + count, 0);
  return total >= 80 && all.every((count) => count >= 18) ? "opening" : "middle";
}

function roleFor(view: BotView, teammate: Seat): SituationAnalysis["role"] {
  const self = view.remainingCardCounts[view.selfSeat];
  const teammateCount = view.remainingCardCounts[teammate];
  const opponents = SEATS.filter((seat) => seat !== view.selfSeat && seat !== teammate).map(
    (seat) => view.remainingCardCounts[seat]
  );
  const opponentMin = Math.min(...opponents);
  if (teammateCount <= 3 || teammateCount + 2 < self)
    return {
      kind: "support",
      confidence: cap(0.55 + (self - teammateCount) / 20),
      reason: "队友剩余牌更少，优先支持其冲刺或保住牌权"
    };
  if (self + 2 < teammateCount && self <= opponentMin)
    return {
      kind: "attack",
      confidence: cap(0.55 + (teammateCount - self) / 20),
      reason: "己方剩余牌最少且领先队友，适合承担进攻路线"
    };
  return { kind: "neutral", confidence: 0.3, reason: "公开剩余牌未显示明确的己方主攻或助攻优势" };
}

/**
 * 仅将 BotView 中的公开信息转化为局面摘要；绝不从事件 cardId 反推对手牌面，
 * 也绝不读取 TurnState、seed、牌堆或其他座位的手牌。
 */
export function analyzeSituation(view: BotView): SituationAnalysis {
  const actions = canonicalActions(view.publicEvents);
  const teammateSeat = teammateOf[view.selfSeat];
  const opponents = SEATS.filter((seat) => seat !== view.selfSeat && seat !== teammateSeat);
  const phase = phaseFor(view.remainingCardCounts);
  const immediateFinishSeats = opponents.filter((seat) => view.remainingCardCounts[seat] === 1);
  const opponentMin = Math.min(...opponents.map((seat) => view.remainingCardCounts[seat]));
  const threatLevel: ThreatLevel =
    immediateFinishSeats.length > 0
      ? "critical"
      : opponentMin <= 3
        ? "high"
        : opponentMin <= 6
          ? "medium"
          : "low";
  const threatReasons: SituationEvidence[] = immediateFinishSeats.length
    ? [
        {
          kind: "fact",
          confidence: 1,
          reason: `对手 ${immediateFinishSeats.join("、")} 仅剩 1 张，存在直接出完威胁`
        }
      ]
    : [
        {
          kind: "fact",
          confidence: 1,
          reason: `对手最少剩余 ${opponentMin} 张，威胁等级来自公开余牌`
        }
      ];
  const teammateRemaining = view.remainingCardCounts[teammateSeat];
  const teammateReasons: SituationEvidence[] = [
    { kind: "fact", confidence: 1, reason: `队友 ${teammateSeat} 公开剩余 ${teammateRemaining} 张` }
  ];
  const isHolding = view.highestSeat === teammateSeat;
  if (isHolding)
    teammateReasons.push({ kind: "fact", confidence: 1, reason: "队友当前公开压住牌权" });
  const isSprinting = teammateRemaining <= 3;
  if (isSprinting)
    teammateReasons.push({ kind: "fact", confidence: 1, reason: "队友进入公开冲刺区间" });
  const publicCards = publicCardSummary(actions);
  const playerTendencies = SEATS.map((seat) => tendencyFor(seat, actions));
  const reasoning = [
    { kind: "fact" as const, confidence: 1, reason: `局面阶段为 ${phase}，由公开余牌决定` },
    ...threatReasons,
    ...teammateReasons,
    ...playerTendencies.flatMap((item) => item.evidence)
  ];
  const publicEventSequence =
    actions.length === 0 ? 0 : Math.max(...actions.map((action) => action.sequence));
  const fingerprint = JSON.stringify({
    selfSeat: view.selfSeat,
    leader: view.leader,
    highestSeat: view.highestSeat,
    levelRank: view.levelRank,
    remainingCardCounts: SEATS.map((seat) => [seat, view.remainingCardCounts[seat]]),
    actions,
    publicEventSequence
  });
  return {
    fingerprint,
    publicEventSequence,
    phase,
    publicCards,
    playerTendencies,
    opponentThreat: { level: threatLevel, immediateFinishSeats, reasons: threatReasons },
    teammate: {
      seat: teammateSeat,
      remainingCards: teammateRemaining,
      isHolding,
      isSprinting,
      reasons: teammateReasons
    },
    role: roleFor(view, teammateSeat),
    reasoning
  };
}
