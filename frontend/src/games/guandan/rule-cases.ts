export type RuleSection =
  "适用范围" | "牌型与比较" | "回合与结束" | "升级、进贡与抗贡" | "P0 冻结决议";

export interface GuandanRuleCase {
  readonly id: string;
  readonly section: RuleSection;
  readonly title: string;
  readonly input: readonly string[];
  readonly expected: readonly string[];
  readonly source: string;
}

/**
 * P1-05 的固定牌例数据。它刻意只描述已冻结的输入和预期，
 * 由 P1-06 及后续任务实现牌型、比较和状态机后逐例接入规则引擎。
 */
export const GUANDAN_RULE_CASES = [
  {
    id: "scope-double-deck-four-player",
    section: "适用范围",
    title: "双副牌四人对家与手牌数量",
    input: ["两副含大小王完整扑克", "四位玩家，东家与西家为对家"],
    expected: ["总计 108 张实体牌", "每人 27 张", "对家组成两队"],
    source: "docs/resolved-rules.md#适用范围"
  },
  {
    id: "scope-first-round-south-leads",
    section: "适用范围",
    title: "首局固定南家领出",
    input: ["首局", "当前级牌为 2"],
    expected: ["south 为首个领出者"],
    source: "proj-info/adr/ADR-0011-south-first-rules-version.md#决策"
  },
  {
    id: "scope-heart-level-wildcard",
    section: "适用范围",
    title: "红桃级牌逢人配且不改变原牌面",
    input: ["红桃 7 为当前级牌", "选择该牌作为逢人配"],
    expected: ["可代表任意非大小王普通牌", "原 Card 的 hearts/7 牌面保持不变"],
    source: "docs/resolved-rules.md#适用范围"
  },
  {
    id: "pattern-basic-single-pair-triple",
    section: "牌型与比较",
    title: "单张、对子和三张",
    input: ["一张 7", "两张 7", "三张 7"],
    expected: ["分别识别为单张、对子、三张", "每种都按点数比较"],
    source: "docs/resolved-rules.md#牌型与比较"
  },
  {
    id: "pattern-three-with-pair",
    section: "牌型与比较",
    title: "三带二只比较三张点数",
    input: ["三张 8 加一对 3", "三张 9 加一对 2"],
    expected: ["均识别为三带二", "后者更大，只比较三张点数"],
    source: "docs/resolved-rules.md#牌型与比较"
  },
  {
    id: "pattern-three-consecutive-pairs",
    section: "牌型与比较",
    title: "三连对恰为六张",
    input: ["33 44 55"],
    expected: ["识别为恰好三组连续对子、共六张", "比较最高对点数"],
    source: "docs/resolved-rules.md#牌型与比较"
  },
  {
    id: "pattern-steel-plate",
    section: "牌型与比较",
    title: "钢板恰为两组连续三张",
    input: ["333 444"],
    expected: ["识别为六张钢板", "比较最高三张点数"],
    source: "docs/resolved-rules.md#牌型与比较"
  },
  {
    id: "pattern-straight",
    section: "牌型与比较",
    title: "顺子恰为五张连续单牌",
    input: ["3、4、5、6、7，花色可混用"],
    expected: ["识别为五张连续单牌顺子", "比较最高点数"],
    source: "docs/resolved-rules.md#牌型与比较"
  },
  {
    id: "pattern-normal-bomb",
    section: "牌型与比较",
    title: "普通炸弹张数与逢人配上限",
    input: ["四至十张同点数牌", "红桃级牌参与构成"],
    expected: ["4 至 10 张均可为普通炸弹", "先比较张数再比较点数", "最多十张"],
    source: "proj-info/adr/ADR-0001-p0-guandan-rule-freeze.md#决策-3"
  },
  {
    id: "pattern-straight-flush",
    section: "牌型与比较",
    title: "同花顺压过五张及以下普通炸弹",
    input: ["同花色 3、4、5、6、7", "五张普通炸弹"],
    expected: ["前者识别为同花顺", "同花顺获胜"],
    source: "docs/resolved-rules.md#牌型与比较"
  },
  {
    id: "pattern-four-jokers",
    section: "牌型与比较",
    title: "四王炸全局最大",
    input: ["两副牌中的四张王"],
    expected: ["识别为四王炸", "全局最大"],
    source: "docs/resolved-rules.md#牌型与比较"
  },
  {
    id: "compare-normal-following",
    section: "牌型与比较",
    title: "普通跟牌限制与跨牌型压制",
    input: ["上家出一对 7", "响应为一对 8 或炸弹/同花顺"],
    expected: ["普通压制须同牌型、同张数且更大", "炸弹和同花顺允许跨牌型压制"],
    source: "docs/resolved-rules.md#牌型与比较"
  },
  {
    id: "compare-global-hierarchy",
    section: "牌型与比较",
    title: "默认炸弹与同花顺层级",
    input: ["四王炸、六张普通炸弹、同花顺、五张普通炸弹、四张普通炸弹、普通牌型"],
    expected: ["按列举顺序从大到小排序"],
    source: "docs/resolved-rules.md#牌型与比较"
  },
  {
    id: "compare-rank-and-ace-runs",
    section: "牌型与比较",
    title: "单牌排序与 A 的连续边界",
    input: ["大王、小王、级牌、A 至 2", "A-2-3-4-5", "10-J-Q-K-A"],
    expected: ["单牌按指定顺序排序", "两种含 A 连续牌型均合法，前者 A 最小、后者 A 最大"],
    source: "proj-info/adr/ADR-0001-p0-guandan-rule-freeze.md#决策-4"
  },
  {
    id: "compare-wildcard-interpretations",
    section: "牌型与比较",
    title: "逢人配多解释与决策方",
    input: ["含红桃级牌的一组选牌存在多种合法解释"],
    expected: ["规则引擎返回全部合法解释", "真人选择解释", "机器人使用确定性评分或固定 tie-break"],
    source: "docs/resolved-rules.md#牌型与比较"
  },
  {
    id: "turn-leader-and-response-order",
    section: "回合与结束",
    title: "领出者与逆时针响应",
    input: ["首局发牌完成", "非首局进贡完成"],
    expected: ["首局 south 领出", "后续局按进贡后的出牌权领出", "其余玩家逆时针响应"],
    source: "docs/resolved-rules.md#回合与结束"
  },
  {
    id: "turn-three-passes-clear-round",
    section: "回合与结束",
    title: "其余三家过牌后的新轮领出",
    input: ["某玩家成功出牌", "其余三家均过牌"],
    expected: ["最后成功出牌者获得新一轮领出权"],
    source: "docs/resolved-rules.md#回合与结束"
  },
  {
    id: "turn-partner-catches-wind",
    section: "回合与结束",
    title: "末手出完后的接风",
    input: ["玩家最后一手出完", "其余可行动者均过牌"],
    expected: ["该玩家的对家接风领出", "否则按最后成功出牌者通常逻辑继续"],
    source: "docs/resolved-rules.md#回合与结束"
  },
  {
    id: "turn-finish-order-and-inactive-player",
    section: "回合与结束",
    title: "完成顺序和出完玩家不可再行动",
    input: ["四人依次出完手牌"],
    expected: ["记录头游、二游、三游、末游", "已出完玩家不再进入行动队列"],
    source: "docs/resolved-rules.md#回合与结束"
  },
  {
    id: "settlement-level-up",
    section: "升级、进贡与抗贡",
    title: "头游方的升级档位",
    input: ["头游加二游", "头游加三游", "头游加末游"],
    expected: ["分别升 3、2、1 级"],
    source: "docs/resolved-rules.md#升级、进贡与抗贡"
  },
  {
    id: "settlement-single-tribute-and-return",
    section: "升级、进贡与抗贡",
    title: "单下进贡和还贡",
    input: ["非首局单下", "末游手中有非红桃级牌", "头游可选还贡牌"],
    expected: ["末游进贡最大非红桃级牌", "头游还任意一张按当前级牌排序不大于 10 的牌"],
    source: "proj-info/adr/ADR-0001-p0-guandan-rule-freeze.md#决策-5"
  },
  {
    id: "settlement-anti-tribute-proof",
    section: "升级、进贡与抗贡",
    title: "单下和双下抗贡及亮王证明",
    input: ["单下末游有两张大王", "双下两名末游各有一张大王，或一人有两张大王"],
    expected: ["对应情形全体抗贡", "必须公开展示两张大王", "其他情形不亮牌"],
    source: "proj-info/adr/ADR-0001-p0-guandan-rule-freeze.md#决策-6"
  },
  {
    id: "settlement-double-tribute-and-return",
    section: "升级、进贡与抗贡",
    title: "双下进贡分配和还贡",
    input: ["双下两名末游向两名赢家进贡"],
    expected: ["头游选较大进贡者，对家对应较小进贡者", "两位赢家各还一张不大于 10 的牌"],
    source: "docs/resolved-rules.md#升级、进贡与抗贡"
  },
  {
    id: "settlement-next-leader",
    section: "升级、进贡与抗贡",
    title: "进贡后首出权和同点/抗贡分支",
    input: ["进贡牌大小不同", "进贡牌大小相同", "发生抗贡"],
    expected: ["较大进贡牌的一家先出", "同点时头游下家先出", "抗贡时上游先出"],
    source: "proj-info/adr/ADR-0001-p0-guandan-rule-freeze.md#决策-2"
  },
  {
    id: "settlement-level-a-win-and-exclusions",
    section: "升级、进贡与抗贡",
    title: "打 A 获胜条件与未启用附加条款",
    input: ["已打 A 后双上获胜", "连续三局未双上", "最小牌额外升级"],
    expected: ["仅双上赢得整场", "默认不实现退回 2", "默认不实现最小牌额外升级"],
    source: "docs/resolved-rules.md#升级、进贡与抗贡"
  },
  {
    id: "freeze-no-tournament-management",
    section: "P0 冻结决议",
    title: "首个单机版排除赛事管理条款",
    input: ["首个单机版范围"],
    expected: ["不实现赛事积分、违规处罚、超时", "亮牌仅用于抗贡两张大王证明"],
    source: "docs/resolved-rules.md#P0 冻结决议"
  }
] as const satisfies readonly GuandanRuleCase[];

export const REQUIRED_RULE_IDS = [
  "scope-double-deck-four-player",
  "scope-first-round-south-leads",
  "scope-heart-level-wildcard",
  "pattern-basic-single-pair-triple",
  "pattern-three-with-pair",
  "pattern-three-consecutive-pairs",
  "pattern-steel-plate",
  "pattern-straight",
  "pattern-normal-bomb",
  "pattern-straight-flush",
  "pattern-four-jokers",
  "compare-normal-following",
  "compare-global-hierarchy",
  "compare-rank-and-ace-runs",
  "compare-wildcard-interpretations",
  "turn-leader-and-response-order",
  "turn-three-passes-clear-round",
  "turn-partner-catches-wind",
  "turn-finish-order-and-inactive-player",
  "settlement-level-up",
  "settlement-single-tribute-and-return",
  "settlement-anti-tribute-proof",
  "settlement-double-tribute-and-return",
  "settlement-next-leader",
  "settlement-level-a-win-and-exclusions",
  "freeze-no-tournament-management"
] as const;
