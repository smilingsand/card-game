# 掼蛋参考项目机器人策略研究与迁移规划

> 日期：2026-07-19
> 范围：只读分析 `D:\MyWorks\niuma-wj-server`、`D:\MyWorks\GuanDanInOffice`，并与 Card Game Platform 当前 normal / P2.5 expert 链路对照。
> 本文不修改规则、ADR、profile 或生产策略；所有“迁移”均指后续以本项目规则引擎重新实现，而非复制源码。

## 结论摘要

- `niuma-wj-server` 最值得借鉴的是“结构优先”的候选构建：点数/花色计数图、逢人配占用计数、完整结构的破坏/保留代价、以及按最小可行压制排队。它的随机 pass、服务端对象耦合和不透明排序不适合迁入。
- `GuanDanInOffice` 的 `Bot` 是一个快速但不完整的最小压制基线。其“按逻辑点数分组，先取最小可压同型牌；三带二选最小可用对子”的局部思想可作为 normal 的回归 oracle；其规则识别、无队友协作和“有炸就炸”不可采用。
- 当前 normal 已有规则引擎提供的合法动作、同型最小比较键、基础不压队友、炸弹抑制、自然顺子/王对保护和一张对手尾局阻断。但它没有整手结构、三带二附带牌专门成本、2～5 张对手威胁模型、可解释的 contest 判定或后手路线；这些能力目前只在 expert 链路中存在。
- 手工试玩的七类问题中，expert 的最近修复已覆盖“低成本压制、避免王压小单、不压队友、低附带对子、最小三带二、敌方连续持权”。它们尚未迁回 normal；normal 改进应保持独立版本化回归基线，不能把 expert 深度链路静默降级为默认策略。

## 1. 研究方法、边界与规则基准

本次仅读取源码、文档、许可证和测试脚本；没有运行参考项目、没有启动本项目性能门禁，也没有检查或使用任何对手隐藏手牌。兼容性以本项目 `docs/resolved-rules.md` 为唯一准则：108 张双副牌、红桃级牌唯一逢人配、A 可在 A2345 或 10JQKA 中使用、同花顺位于 5 炸与 6 炸之间、四王最大。

参考项目是实现样本，不是规则来源。下文“支持”指其源码明确实现；“未见”仅表示在本次目标文件和调用链中未发现，而非证明全仓库绝无此能力。

## 2. 两个项目的策略相关文件地图

| 项目  | 文件                                                                                   | 职责与观察                                                                                                    |
| ----- | -------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------- |
| niuma | `Server/GuanDan/GuanDanAvatar.{h,cpp}`                                                 | 策略核心。建立点数/花色图，搜索顺子、钢板、木板、三带二、炸弹和同花顺；合并不冲突结构，构造实体牌候选并排序。 |
| niuma | `Server/GuanDan/GuanDanSearch.{h,cpp}`、`GuanDanSearchGroup.{h,cpp}`                   | 单个结构及兼容结构组，承载点数图、逢人配数、破坏/保留值。                                                     |
| niuma | `Server/GuanDan/GuanDanCandidateOrder.{h,cpp}`                                         | 两张预计算候选序列表；以牌型和主牌构成 key，不做深度评估。                                                    |
| niuma | `Server/GuanDan/GuanDanRule.{h,cpp}`                                                   | 级牌/红桃逢人配、牌型识别、比较、炸弹层级和 A2345。                                                           |
| niuma | `Server/GuanDan/GuanDanRoom.{h,cpp}`                                                   | 自动出牌入口；取首个候选，并以队友、对手剩余牌数及随机数决定 pass。                                           |
| niuma | `Poker/PokerAvatar.{h,cpp}`、`Poker/PokerRule.{h,cpp}`、`Poker/PokerUtilities.{h,cpp}` | 通用手牌、组合、排序、顺子取牌和候选容器。                                                                    |
| niuma | `Framework/Game/RobotManager.{h,cpp}`                                                  | 仅机器人帐号申请/释放；不含掼蛋决策。                                                                         |
| GDI   | `src/shared/bot.ts`                                                                    | 极简 Bot：领出三带二/对子/最小单，跟牌只处理单、对、三张、三带二，再尝试炸弹。                                |
| GDI   | `src/shared/rules.ts`、`types.ts`                                                      | TypeScript 牌型识别、比较、逻辑点数与逢人配表示。                                                             |
| GDI   | `src/server/game.ts`、`room.ts`                                                        | 服务端回合调度；向 Bot 传自己的手牌与当前目标，再由游戏层复核出牌。                                           |
| GDI   | `test-bot-game.ts`                                                                     | 独立四 Bot 随机对局、日志、最大 500 回合保护。                                                                |
| GDI   | `test-skill-bot-game.ts`                                                               | mock Socket/Timer 后驱动真实 `Game` 的技能模式烟测。                                                          |

## 3. 决策调用链

### 3.1 niuma-wj-server

```text
GuanDanRoom::autoExecute
  -> autoPlayCard(avatar)
     -> avatar.getFirstCandidate()
        -> PokerAvatar 候选刷新
           -> GuanDanAvatar::combineAllGenres()
              -> 搜索结构 / 计算 damages 与 undamages
              -> 合并无冲突 SearchGroup
              -> makeCombinations() 分配实体牌 ID
           -> candidateCombinationsImpl(领出 | 跟牌)
              -> CandidateOrder / gatherOther / gatherStraight / gatherBomb
     -> makePassDecision() 或 doPlayCard()
```

领出采用已构造的牌型组合；跟牌先取同型、同长度且更大的组合，再补动态收集的顺子/普通牌/炸弹。`autoPlayCard` 只取第一个候选，因此排序几乎等同于策略。`makePassDecision` 在候选已存在时仍可选择 pass。

### 3.2 GuanDanInOffice

```text
Game::handleBotTurn
  -> new Bot(hand, level)
  -> Bot::decideMove(lastHand?.hand ?? null)
     -> getGroups / findBeat / findPairExcluding / findBomb
  -> Game::handlePlayHand 或 handlePass
     -> getHandType + compareHands（服务端再次裁决）
```

该链路没有局面分析、候选集或评分器：每个分支直接返回一手牌，首个命中的候选即为决定。

## 4. niuma：手牌分析、候选与排序

### 4.1 结构分析

`GuanDanAvatar::analyzeIgnore` 将红桃级牌从自然统计中剥离为 `_variableCards`，并维护 `13 × 4` 点数-花色计数图。`combineAllGenres` 滑动扫描五点窗口和二/三点窗口：

- 顺子同时记录可叠层数和可同花的花色；`takeSameSuit` 优先消耗逢人配完成花色，故可发现同花顺。
- 钢板（两连三张）、木板（三连对）分别在 2/3 点窗口上以 0～2 张逢人配补齐。
- `seachThreeWith2`（原拼写如此）从未被钢板/木板占用的三张、对子开始，再放宽到可拆结构，生成三带二搜索项。
- 普通炸弹按同点数 4～10 张生成；四王、同花顺由规则/专门收集路径处理。
- 结构搜索会记录 `damages`（拆结构代价）和 `undamages`（保留/完整结构收益），并尝试合并相互不冲突的 `GuanDanSearchGroup`。这确实是在生成整手分组候选；代码中未见类似本项目 `estimatedTurns` 的明确输出字段。

该方法不是全实体子集暴力枚举：先在 13 个点数和 4 个花色的压缩图上搜索，再在 `makeCombinations` 阶段回填实体牌 ID。代价是其结构合并、回填和排序逻辑高度耦合且复杂。

### 4.2 候选生成与爆炸控制

- 领出：从 `_combinations` 中读取预构造组合，普通牌通过 `GuanDanCandidateOrder` 获得顺序；炸弹追加在后。
- 跟牌：已有同型组合按主牌过滤；没有预构造的同型或炸弹时，`gatherStraight`、`gatherOther`、`gatherBomb` 才按需构造。炸弹路径明确先尝试最少逢人配。
- 去重以“牌型 + 主牌”及实体牌占用集合为主；`_occupiedCardIds` 防止一个组合重复取牌。
- Search/SearchGroup 有 `_freeSearches`、`_freeGroups` 空闲链表复用；同花顺 ID 缓存供提示使用。它没有固定深度预算，复杂度主要依赖小维度计数图、结构合并和早期去重。

### 4.3 排序、pass 与协作

`GuanDanCandidateOrder` 有两套固定顺序：普通情况将低位单/对、低顺子、低三张/三带二排前；第二套更偏向先出顺子、三带二、长结构。它并不直接读取剩余手牌质量，质量主要经 `damages/undamages` 和“bad”候选间接表达。

`makePassDecision` 的可迁移策略意图是：

- 队友当前压住时，不用炸弹、王或 `bad`（拆结构）候选抢牌；队友少于 3 张且敌方也逼近尾局时才有条件例外。
- 敌方持权时，王的单/对/三张倾向必压；全是大牌且不拆结构时倾向压；炸弹或坏候选随敌方剩余牌数提高压牌意愿。

但实现用 `BaseUtils::randInt` 概率 pass，且阈值与注释有不一致处。这违反本项目“同一 seed + state + action 得到相同结果”的纯确定性契约，不能直接迁入。

### 4.4 规则与信息边界

`GuanDanRule` 明确实现红桃级牌逢人配、A2345、三连对/钢板、4～10 炸、同花顺和四王；炸弹顺序与本项目冻结规则大体一致。仍必须逐牌例对照：其 C++ 通用 `PokerRule` 继承链、枚举点数、级牌在连续牌型中的处理，以及“同点数四张王”表示均不能假定与本项目解释语义相同。

本次追踪到的 Bot 决策只读取自己的 `GuanDanAvatar` 手牌、当前出牌、座位关系与其他座位的剩余张数，未发现直接读取对手牌面。但该策略运行在持有全部手牌的服务端对象图中，类型边界并不防止未来误读隐藏信息；迁入时必须仅接受 `BotView`。

## 5. GuanDanInOffice：快速基线及其限制

### 5.1 实际策略

- 领出：优先最小三张加“排除主三张后的最小对子”；否则最小对子，再最小单。注释提到顺子/钢板/木板优先，但实现并没有领出这些牌型。
- 跟牌：仅为单、对、三张、三带二按小到大找第一个可压组合；顺子分支是 TODO，钢板/木板也无同型跟牌。
- 炸弹：普通牌无法压时无条件尝试最小普通炸、自然同花顺、四王；对 5 炸以下允许同花顺压制，对同花顺尝试 6 炸以上或四王。
- `findPairExcluding` 是最直接可借鉴的局部规则：三带二主三张确定后，在剩余牌中返回最小对子。因此自然避免把主三张重复用作附带牌，并通常保留较大对子。

### 5.2 规则函数与性能

`rules.ts` 是纯函数风格，`sortCards`、`getHandType`、`compareHands` 的职责分离可借鉴；但实现并不满足本项目的完整规则契约：

- `getAllPossibleHandTypes` 对较长含逢人配组合明确留有 TODO；不是完整解释枚举。
- 顺子、钢板、木板对逢人配的处理不完整，Bot 的同花顺仅识别自然牌。
- `getGroups` 将逻辑点数相同的级牌/逢人配混合为分组，未表达实体解释和逢人配占用。
- 无队友座位、公开事件、剩余牌数或残局模型；“有炸就炸”会造成显著资源浪费。

它快的原因很简单：排序一次后线性分组，按牌型有限分支首命中返回；不枚举所有解释、不做整手重组、不做后继分析。性能优秀的代价是漏掉大量合法压制与策略机会。

### 5.3 测试观察

`test-bot-game.ts` 每局随机洗牌，四 Bot 轮流决策，调用 `getHandType` 和 `compareHands` 复核出牌，记录 pass/出牌，并以 500 回合上限防死循环；它是有价值的轻量烟测模板。它没有固定 seed、断言指标、失败局面快照或候选诊断。`test-skill-bot-game.ts` mock 计时器和 Socket，驱动真实 `Game`，同样是日志型烟测。

可迁移的是“自动局必须在规则层复核”“回合上限”和“失败时输出局面”；必须改为本项目的确定性 seed、事件流和固定牌例断言。

## 6. 与当前 normal / P2.5 对照

| 维度        | 当前 normal                              | 当前 expert（P2.5）                           | niuma                        | GDI                       |
| ----------- | ---------------------------------------- | --------------------------------------------- | ---------------------------- | ------------------------- |
| 合法性来源  | 规则引擎给出的 `legalActions`            | 完整规则候选 A 层                             | 自有组合/规则对象            | 游戏层再复核              |
| 领出        | `basic-bot` 启发式                       | 完整语义候选 + 多模块评分                     | 整手结构组合                 | 三带二/对/单，遗漏长牌型  |
| 跟牌        | 以 comparison key 简单评分；非队友时偏压 | contest + 动作后手牌 + follow-up              | 同型过滤 + 动态 gather       | 仅四类普通牌，其他多 pass |
| 结构        | 仅局部拆组/自然顺子保护                  | `HandStructureAnalyzer` + `HandPlanGenerator` | Search/SearchGroup 整手合并  | 逻辑点数分组              |
| 三带二附带  | 无专用成本模型                           | 已有 R44 与精确附带值                         | 由组合/破坏代价间接影响      | 明确选最小可用对子        |
| 控制资源    | 王对、顺子、炸弹的局部保护               | `ControlResourceEvaluator`                    | bad/damage、王/炸弹保留      | 无                        |
| 协作 / 尾局 | 队友持权 pass、仅对手 <=1 阻断           | Situation + Contest + 规则库                  | 队友不压、看剩余张数，但随机 | 无                        |
| 性能        | 不做深度分析                             | 24/32 受预算、缓存、语义去重                  | 压缩图、对象复用，无固定预算 | 线性首命中                |
| 可解释性    | reasons 字符串                           | `DecisionExplanation` 完整证据                | 不透明候选顺序               | 无                        |

### 当前 normal 已具备与明显缺失

`normal-bot.ts` 在跟牌时使用规则引擎已经生成的全部合法动作，按最小比较键选低成本压制；队友当前最高时强烈偏向 pass；敌方只剩一张时提高出牌优先级；有非炸弹牌时抑制炸弹，并保护王对和自然顺子。领出仍委托 `basic-bot.ts`，其中有简单拆组、逢人配降级和恢复牌保护。`legacy-normal-candidates.ts` 是桌面提示候选路径：领出只合成单、同点数组、自然三带二和自然顺子；跟牌含固定张数的子集组合，可能昂贵且不完整，但不是 normal 自动决策的候选源。

normal 缺少：完整手牌结构/计划、对子附带成本、2～5 张威胁尺度、敌方连续持权、控制预算、明确 contest、后继路线、固定候选诊断和完整决策解释。它不应直接调用 expert 的深度分析，否则会破坏已冻结的 normal 基线和 profile 隔离。

## 7. 对人工试玩问题的对应建议

| 问题                        | 现状                                         | 最适合的后续能力                                                                                              |
| --------------------------- | -------------------------------------------- | ------------------------------------------------------------------------------------------------------------- |
| 有低成本合法压制却持续 pass | expert 已修正；normal 缺少显式最低同型响应表 | A：从合法动作按牌型/比较键取最低响应，pass 仅在协作或资源例外胜出；借鉴 niuma 同型先行与 GDI 首命中。         |
| 小单张用小/大王             | normal 仅局部王对保护                        | A：把王、级牌、A 的响应成本表加入 normal，并优先自然低单；借鉴 niuma 的“王不压队友”，用本项目确定性规则实现。 |
| 压住队友                    | normal 已强偏 pass，但缺少尾局例外分类       | A：明确硬规则“队友持权不得接管”，仅队友无法收尾且敌方即时威胁时例外。                                         |
| 三带二附高对子              | normal 无附带评分                            | A：主三张固定时在剩余合法对子中选最低资源成本；直接采用思想，不复制 GDI 函数。                                |
| 小三带二不如大三带二        | normal 无同型最小主三张规则                  | A：按主三张 comparison key 取最低；附带牌仅作为第二排序键。                                                   |
| 开/中局过保守               | normal 没有阶段化 contest                    | B：轻量结构分和对手 2/5/连续持权压力，替代“只看 <=1 张”。                                                     |
| 残局不阻断对手              | normal 只识别一张威胁                        | A：对敌方 1、2、3 张设置确定性阻断优先级；B 再引入资源成本折中。                                              |

## 8. 可借鉴、不可迁移与复用边界

| 分类           | 内容                                                                                                                                     | 处理                                                                                                           |
| -------------- | ---------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------- |
| 可直接复用     | 无                                                                                                                                       | 本阶段不复制任何代码。即使 niuma 是 MIT，C++ 数据模型和本项目 TS 规则契约也不匹配；GDI 没有仓库 LICENSE。      |
| 可改写后复用   | niuma 的压缩点数/花色扫描、最少逢人配构造、破坏/保留代价；GDI 的最低同型响应和三带二最低附带对子                                         | 仅记录算法行为，以本项目 `Card` ID、`recognizePatterns`、`getLegalActions`、`BotView` 重新实现，并写固定牌例。 |
| 只借鉴算法思想 | niuma 的“先结构、后实体组合”、对象/结果复用；GDI 的规则层复核和回合上限自动对局                                                          | 采用本项目的候选预算、语义规范化、缓存和确定性 tie-break。                                                     |
| 不建议使用     | niuma 随机 pass、`getFirstCandidate` 隐式策略、服务端 Avatar 全状态耦合；GDI 的不完整逢人配/长牌型、无队友协作、无条件炸弹、随机日志测试 | 不迁移。                                                                                                       |

### 许可证与风险

- `niuma-wj-server/LICENSE` 是 MIT（2025 The NiuMa project authors）：若未来复制实质性代码，可在满足保留版权与许可文本的前提下进行，但仍需代码审查、来源记录和本项目规则兼容性验证。本规划建议 clean-room 改写，因而不依赖直接复用许可。
- `GuanDanInOffice` 根目录及仓库文件未发现 `LICENSE`/`COPYING`/`NOTICE`；`package.json` 的 `license: "ISC"` 只是元数据，不能替代明确仓库许可和作者授权。其代码只能作为不可复制的行为参考；不得直接拷贝或改写近似实现，直到取得明确书面授权/许可证确认。
- 以上是工程复用风险判断，不构成法律意见。

## 9. 推荐迁移优先级与实施规划（不实现）

### Normal Bot Improvement A

**目标**：修复最低成本合法压制、三带二最低成本附带对子、不压队友，以及敌方 1～3 张时的基础尾局阻断。

- 借鉴来源：niuma 的同型候选优先、队友持权不接管和最少逢人配；GDI 的 `findBeat` / `findPairExcluding` 首个最小匹配思想。
- 修改模块：`frontend/src/games/guandan/normal-bot.ts`，必要时新增纯 `normal-response-ranking.ts`；只消费 `BotView.legalActions`，不修改规则引擎或 `legacy-normal-candidates.ts`。
- 风险：comparison key 的复杂牌型语义、逢人配多解释、队友收尾例外可能改变 normal 固定输出。
- 测试：新增固定牌例覆盖七类问题中的前五类及敌方 1/2/3 张；属性测试确认结果始终属于 `legalActions`；保留原 `normal-bot.test.ts` 全量基线。
- 是否影响 normal 回归基线：会，必须将行为变化列为 normal vNext 基线，逐例审查，而非静默替换。
- 是否可独立回滚：可以。以单独的 normal 策略版本/单文件模块和测试提交隔离。

### Normal Bot Improvement B

**目标**：引入轻量手牌结构评分、控制牌成本、合理 pass / contest 判定，消除开中局机械保守。

- 借鉴来源：niuma 的 `damages/undamages` 与“坏候选”概念；本项目 expert 的 `HandStructureAnalyzer`、`ControlResourceEvaluator`、`SituationAnalyzer` 与 `ContestEvaluator` 的已验证语义，但必须写 normal 轻量投影，不能调用深度链路。
- 修改模块：新增 `normal-hand-structure-score.ts`、`normal-contest.ts`；由 `normal-bot.ts` 组合。输入限于自己的手牌、公开事件、剩余张数、合法动作。
- 风险：轻量评分若与 expert 共用实现会引入性能/耦合；过度惩罚拆组会重现过度 pass。
- 测试：开局/中局/残局固定牌例；敌方连续持权与 2/5 张威胁；控制牌（A、级牌、王、炸弹）机会成本；确定性与 `BotView` 信息边界测试。
- 是否影响 normal 回归基线：会，建议建立版本化 normal-vNext 牌例目录，并对 normal-v1 差分审查。
- 是否可独立回滚：可以。评分器只影响 normal selector，可按 profile/version 开关撤回。

### Normal Bot Improvement C

**目标**：将经固定牌例证明有效的候选排序固化为 normal 策略，并补齐自动对局指标与回归防线。

- 借鉴来源：niuma 的两种局面排序表、同型先行/炸弹后置、Search 对完整结构的保留；GDI 的规则层复核、最大回合保护。只采用已由 A/B 牌例证明有效的规则。
- 修改模块：`normal-response-ranking.ts`、`normal-bot.ts`、`simulation.ts`、normal 测试与新增固定 fixture/指标报告工具；不触碰 P2.5 ADR、expert profile 或性能门禁。
- 风险：排序表隐藏权重难以解释；随机对局会掩盖退化；模拟工具若使用全状态必须只向 Bot 传 `BotView`。
- 测试：固定 seed 自动对局、每步规则合法性、最大回合、防异常决策日志、normal-v1/vNext 差分；指标至少含非法动作 0、强制 pass 0、队友抢牌、王压低单、三带二高附带、尾局漏阻断和平均回合数。不得在本任务中启动 P2.5 性能门禁。
- 是否影响 normal 回归基线：会；仅在人工审查固定牌例、自动对局差分和文档验收后更新基线。
- 是否可独立回滚：可以。候选排序和指标工具与 A/B 分离；策略版本保持可选且默认切换另行批准。

## 10. 建议的验收顺序

先实施 A，确认它只修复低成本响应和协作硬规则；再实施 B 的轻量、可解释评分；最后实施 C 的排序和自动回归。每阶段均应先写失败牌例，再实现最小纯 TypeScript 逻辑，并用本项目规则层裁决。任何涉及规则解释、profile 默认值、候选预算或随机性的变化，先单独 ADR；本研究本身不作此类变更。
