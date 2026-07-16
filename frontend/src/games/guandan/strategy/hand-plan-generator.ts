import type { HandStructureAnalysis, HandStructureGroup } from "./hand-structure-analyzer";

export type HandPlanRole = "attack" | "support" | "neutral";
export type HandPlanKind =
  "best_structure" | "minimum_turns" | "conservative_control" | "team_support";

export interface HandPlanPerformanceBudget {
  readonly handPlanTopN: { readonly default: number; readonly max: number };
}

export type HandPlanGroup = HandStructureGroup;

export interface HandPlanMetrics {
  readonly estimatedTurns: number;
  readonly structuralIntegrity: number;
  readonly naturalBombCount: number;
  readonly wildcardUsage: {
    readonly count: number;
    readonly cardIds: readonly string[];
    readonly purposes: readonly string[];
  };
  readonly lowSingleCount: number;
  readonly weakPairCount: number;
  readonly control: { readonly cardIds: readonly string[]; readonly count: number };
  readonly recovery: { readonly cardIds: readonly string[]; readonly count: number };
  readonly roleFit: number;
  readonly finishability: number;
  readonly deadHandRisk: number;
}

export interface HandPlan {
  readonly id: string;
  readonly kind: HandPlanKind;
  readonly groups: readonly HandPlanGroup[];
  readonly metrics: HandPlanMetrics;
}

export interface GenerateHandPlansInput {
  readonly structure: HandStructureAnalysis;
  readonly performanceBudget: HandPlanPerformanceBudget;
  readonly role?: HandPlanRole;
}

const PLAN_KINDS: readonly HandPlanKind[] = [
  "best_structure",
  "minimum_turns",
  "conservative_control",
  "team_support"
];

const GROUP_WEIGHT: Readonly<Record<HandStructureGroup["kind"], number>> = {
  single: 0,
  pair: 5,
  triple: 9,
  "three-with-pair": 19,
  "three-consecutive-pairs": 27,
  "steel-plate": 28,
  straight: 20,
  "normal-bomb": 35,
  "straight-flush": 39,
  "four-jokers": 45
};

const uniqueSorted = (values: readonly string[]) => [...new Set(values)].sort();
const groupKey = (group: HandStructureGroup) =>
  `${group.kind}|${group.source}|${group.cardIds.join(",")}|${JSON.stringify(group.wildcardAs)}`;

function planHash(value: string): string {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(36);
}

/**
 * 生成器只接收由版本化 profile/config 层加载并验证过的预算。
 * 此处仅防御本模块的四类方案不变量；ADR 的最大值由配置校验层负责。
 */
function handPlanCount(budget: HandPlanPerformanceBudget): number {
  const { default: requested, max } = budget.handPlanTopN;
  if (!Number.isInteger(requested) || !Number.isInteger(max) || requested < PLAN_KINDS.length)
    throw new Error("HandPlan Top-N 必须至少覆盖四类方案");
  if (max < requested || max < PLAN_KINDS.length)
    throw new Error("HandPlan Top-N 性能预算必须是递增的有效配置");
  return requested;
}

function scoreGroup(
  group: HandStructureGroup,
  kind: HandPlanKind,
  controlIds: ReadonlySet<string>,
  naturalBombExists: boolean
): number {
  const wildcardCount = Object.keys(group.wildcardAs).length;
  const controlCount = group.cardIds.filter((id) => controlIds.has(id)).length;
  let score = GROUP_WEIGHT[group.kind] + group.cardIds.length * 3;
  if (group.source === "natural") score += 12;
  if (group.source === "split_from_existing_group") score -= 16;
  if (group.source === "wildcard_completed") score -= wildcardCount * 24;
  if (naturalBombExists && group.kind === "normal-bomb" && group.source === "wildcard_completed")
    score -= 80;

  if (kind === "minimum_turns") score += group.cardIds.length * 16;
  if (kind === "conservative_control") score -= controlCount * 9;
  if (kind === "team_support" && ["pair", "triple", "three-with-pair"].includes(group.kind))
    score += 11;
  return score;
}

function handCardIds(structure: HandStructureAnalysis): readonly string[] {
  return uniqueSorted(
    structure.groups.filter((group) => group.kind === "single").flatMap((group) => group.cardIds)
  );
}

function chooseGroups(
  structure: HandStructureAnalysis,
  kind: HandPlanKind,
  allCardIds: readonly string[]
): readonly HandPlanGroup[] {
  const controlIds = new Set([
    ...structure.control.jokerCardIds,
    ...structure.control.levelCardIds,
    ...structure.control.aceCardIds,
    ...structure.control.bombCardIds,
    ...structure.control.straightFlushCardIds
  ]);
  const naturalBombExists = structure.groups.some(
    (group) =>
      (group.kind === "normal-bomb" ||
        group.kind === "straight-flush" ||
        group.kind === "four-jokers") &&
      group.source === "natural"
  );
  const candidates = structure.groups
    .filter((group) => group.kind !== "single")
    .filter((group) => new Set(group.cardIds).size === group.cardIds.length)
    // 普通整手方案中，天然炸弹已经提供高价值结构时，不再让逢人配参与其他组合。
    // 尾局例外属于动作级策略，不能在本模块凭空假设。
    .filter((group) => !naturalBombExists || group.source !== "wildcard_completed")
    .sort((left, right) => {
      const difference =
        scoreGroup(right, kind, controlIds, naturalBombExists) -
        scoreGroup(left, kind, controlIds, naturalBombExists);
      return difference || groupKey(left).localeCompare(groupKey(right));
    });
  const used = new Set<string>();
  const selected: HandPlanGroup[] = [];
  for (const group of candidates) {
    if (group.cardIds.some((id) => used.has(id))) continue;
    selected.push(group);
    group.cardIds.forEach((id) => used.add(id));
  }

  const singlesById = new Map(
    structure.groups
      .filter((group) => group.kind === "single")
      .map((group) => [group.cardIds[0], group] as const)
  );
  for (const id of allCardIds) {
    if (used.has(id)) continue;
    const single = singlesById.get(id);
    if (!single) throw new Error(`HandStructure 缺少实体牌 ${id} 的单张回退分组`);
    selected.push(single);
  }
  return selected.sort((left, right) => groupKey(left).localeCompare(groupKey(right)));
}

function calculateMetrics(
  structure: HandStructureAnalysis,
  groups: readonly HandPlanGroup[],
  kind: HandPlanKind,
  role: HandPlanRole
): HandPlanMetrics {
  const assigned = new Set(groups.flatMap((group) => group.cardIds));
  const wildcardCardIds = uniqueSorted(groups.flatMap((group) => Object.keys(group.wildcardAs)));
  const wildcardPurposes = groups
    .filter((group) => Object.keys(group.wildcardAs).length > 0)
    .map((group) => group.kind)
    .sort();
  const lowSingleCount = groups.filter(
    (group) =>
      group.kind === "single" && structure.loose.lowSingleCardIds.includes(group.cardIds[0])
  ).length;
  const weakPairCount = groups.filter(
    (group) =>
      group.kind === "pair" &&
      group.cardIds.every((id) => structure.loose.weakPairCardIds.includes(id))
  ).length;
  const naturalBombCount = groups.filter(
    (group) =>
      (group.kind === "normal-bomb" ||
        group.kind === "straight-flush" ||
        group.kind === "four-jokers") &&
      group.source === "natural"
  ).length;
  const controlIds = uniqueSorted(
    [
      ...structure.control.jokerCardIds,
      ...structure.control.levelCardIds,
      ...structure.control.aceCardIds,
      ...structure.control.highPairCardIds,
      ...structure.control.highTripleCardIds,
      ...structure.control.bombCardIds,
      ...structure.control.straightFlushCardIds
    ].filter((id) => assigned.has(id))
  );
  const recoveryIds = structure.recoveryCardIds.filter((id) => assigned.has(id));
  const intactGroups = groups.filter(
    (group) => group.kind !== "single" && group.source !== "split_from_existing_group"
  ).length;
  const structuralIntegrity = Math.max(
    0,
    Math.min(100, 35 + intactGroups * 12 + naturalBombCount * 10 - wildcardCardIds.length * 7)
  );
  const estimatedTurns = groups.length;
  const finishability = Math.max(
    0,
    Math.min(100, 100 - estimatedTurns * 7 + intactGroups * 5 - lowSingleCount * 5)
  );
  const deadHandRisk = Math.max(
    0,
    Math.min(
      100,
      lowSingleCount * 12 +
        weakPairCount * 8 +
        Math.max(0, 2 - recoveryIds.length) * 8 -
        naturalBombCount * 8
    )
  );
  const roleFit = Math.max(
    0,
    Math.min(
      100,
      50 +
        (role === "support" && kind === "team_support" ? 30 : 0) +
        (role === "attack" && kind === "minimum_turns" ? 20 : 0) +
        (role === "neutral" && kind === "best_structure" ? 15 : 0)
    )
  );
  return {
    estimatedTurns,
    structuralIntegrity,
    naturalBombCount,
    wildcardUsage: {
      count: wildcardCardIds.length,
      cardIds: wildcardCardIds,
      purposes: wildcardPurposes
    },
    lowSingleCount,
    weakPairCount,
    control: { cardIds: controlIds, count: controlIds.length },
    recovery: { cardIds: recoveryIds, count: recoveryIds.length },
    roleFit,
    finishability,
    deadHandRisk
  };
}

/**
 * 从 HandStructure 的有限可能组合中用稳定贪心生成全手分组。
 * 本任务只提供固定工作量的生成入口；Early Stop 与跨回合缓存由后续性能任务接入。
 */
export function generateHandPlans(input: GenerateHandPlansInput): readonly HandPlan[] {
  handPlanCount(input.performanceBudget);
  const role = input.role ?? "neutral";
  const allCardIds = handCardIds(input.structure);
  return PLAN_KINDS.map((kind) => {
    const groups = chooseGroups(input.structure, kind, allCardIds);
    const metrics = calculateMetrics(input.structure, groups, kind, role);
    const id = `hand-plan:${kind}:${planHash(
      `${input.structure.fingerprint}|${role}|${kind}|${groups.map(groupKey).join(";")}`
    )}`;
    return { id, kind, groups, metrics };
  });
}
