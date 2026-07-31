# P6 - normal-vNext 跟牌问题只读审计

日期：2026-07-31
分支：`P6-normal-vnext-follow-diagnostics`
状态：已完成第一阶段只读审计，等待确认；未修改策略、规则、阈值或测试。

## 范围与结论

本审计只追踪当前产品 `normal-vNext` 的真实调用、完整合法动作来源及选择器执行顺序。不引入 P5 `leadRouteScore`，不实施策略增强。

- 单人、多人数空座机器人、真人超时/断线托管，以及 simulation 的 `normal-vNext` profile，最终均使用 `chooseNormalVNextBotAction`。
- `legalActions` 由规则层完整枚举并经统一 `validateAction` 过滤；没有证据表明非单张跟牌是因为规则层遗漏。
- 普通领牌在下家不处于 1-6 张尾局威胁时，实际委托给旧 `chooseNormalBotAction`，后者领牌再委托 `chooseBasicBotAction`。
- 跟牌中，完整顺子、连对和钢板会被现有结构损伤成本误判为高损伤，常被安全筛选移除后直接 `pass`。

## 产品调用图

```text
单人 App.tsx
  -> chooseTableBotAction
  -> chooseTableStrategicDecision
  -> getLegalBotActions / createTableBotView
  -> chooseNormalVNextBotAction

多人空座机器人、超时或断线托管
  Room.reconcile -> Authority /bot-command
  -> chooseTableBotAction
  -> chooseNormalVNextBotAction

simulation normal-vNext
  botAction -> getCompleteLegalCandidates / createBotView
  -> chooseNormalVNextBotAction
```

| 场景                      | 调用入口                                                 | BotView 与 legalActions                                                      | 最终策略                     |
| ------------------------- | -------------------------------------------------------- | ---------------------------------------------------------------------------- | ---------------------------- |
| 单人普通机器人            | `frontend/src/App.tsx` 的定时器                          | `getLegalBotActions` -> `getCompleteLegalCandidates` -> `createTableBotView` | `chooseNormalVNextBotAction` |
| 多人空座固定机器人        | `backend/src/authority-game.ts` 的 `/bot-command`        | 同上，Authority 持有权威牌局                                                 | `chooseNormalVNextBotAction` |
| 真人超时/断线托管         | `backend/src/room.ts` 的 `reconcile` 发起 `/bot-command` | 同上                                                                         | `chooseNormalVNextBotAction` |
| simulation `normal-vNext` | `packages/guandan-core/src/games/guandan/simulation.ts`  | `getCompleteLegalCandidates` -> `createBotView`                              | `chooseNormalVNextBotAction` |

`basic` 与旧 `normal` 仍可被 simulation profile 显式选择，但不属于产品机器人入口。`getLegalSingleActions` 是已废弃的兼容导出，实际别名为完整的 `getLegalBotActions`，并非单张专用生成器。

`BotView` 只包含当前座位、自身手牌、公开事件、各座剩余张数、级牌和合法动作；不包含对手手牌或 seed。

## normal-vNext 实际决策优先级

| 优先级 | 分支           | 触发条件                                         | 返回动作                                                          | 会阻断后续 |
| ------ | -------------- | ------------------------------------------------ | ----------------------------------------------------------------- | ---------- |
| 1      | 普通领牌       | `highestSeat === undefined` 且下家剩余至少 7 张  | `chooseNormalBotAction`；其领牌再调用 `chooseBasicBotAction`      | 是         |
| 2      | 尾局领牌       | 下家剩余 1-6 张                                  | `rankThreatLeadCandidates` 的首项；炸弹后置，其他按较大比较键优先 | 是         |
| 3      | 领牌兜底       | 上述路径无动作                                   | 第一个 play，否则 pass                                            | 是         |
| 4      | 队友持权       | 当前最高牌为队友、存在 pass、且无直接出完候选    | pass                                                              | 是         |
| 5      | 直接出完       | 任一跟牌候选可清空自身手牌                       | 该候选                                                            | 是         |
| 6      | 强制阻断       | 下家剩余 1-3 张                                  | 非炸弹优先，再按从大到小取首项                                    | 是         |
| 7      | 高价值中型结构 | 全部候选均为对子/三张/三带二，且都有高控制牌惩罚 | pass                                                              | 是         |
| 8      | 普通跟牌       | 其余跟牌情况                                     | 最低 `responseCost` 的安全候选；没有安全候选时 pass               | 是         |
| 9      | 合法动作兜底   | 没有已选动作                                     | 第一个 play，否则 pass                                            | 是         |

普通跟牌排序为：非炸弹优先；三带二先比较主三张点数、再比较附带对子成本；其后按 `responseCost` 升序、比较键升序、JSON 字符串稳定 tie-break。`responseCost` 为点数、结构损伤、控制资源、红桃级牌机会成本和三带二附带对子成本之和。

强制阻断例外使用降序比较：较大的 `comparisonKey` 排在前，因此会选最大可压牌而不是最小足够压制。

## 现有能力盘点

| 类别                          | 已确认能力                                                                                                      |
| ----------------------------- | --------------------------------------------------------------------------------------------------------------- |
| A：已实现且可达               | 单张最低成本压制；自然对子、三张、三带二跟牌；队友持权让牌；下家 1-3 张阻断；直接出完；合法动作兜底             |
| C：主要对单张有效             | 低成本压制，以及 A、级牌、大小王的资源保护                                                                      |
| D：尾局有效                   | 下家 1-6 张领牌威胁和 1-3 张强制阻断                                                                            |
| E：队友场景有效               | 队友持权且不能直接出完时无条件 pass                                                                             |
| F：有代码但未作为一般选择依据 | `describeNormalVNextContest` 的 `recommended` 和 `actionScore` 主要是诊断；产品选择器只读取其中的高价值惩罚条件 |
| G：文档与代码可能不一致       | 若文档声称非单张自然结构会普遍跟牌，则与顺子、连对、钢板的实际安全筛选结果不一致                                |
| H：阈值极易触发               | 普通结构阈值为 239；拆对子成本为 240；完整顺子、连对和钢板分别会累计到 4000、2700、2000                         |

## 固定诊断牌例轨迹

以下牌例是对现有固定牌例和选择器代码的只读映射。`E` 是机器人，`W` 是队友，`S/N` 是对手；默认 `highestSeat=S`、级牌为 2、无公开事件、下家 N 剩 8 张。

| #   | BotView 摘要与 legalActions            | 分支/候选排序                            | 最终选择                   |
| --- | -------------------------------------- | ---------------------------------------- | -------------------------- |
| 1   | `hand: 8,J,A`; `pass, 8, J, A`         | 普通跟牌；`8 < J < A + 控制成本`         | 8                          |
| 2   | `hand: 88,QQ`; `pass, 88, QQ`          | 普通跟牌；对子比较键升序                 | 88                         |
| 3   | `hand: 888`; `pass, 888`               | 自然三张，结构损伤 0                     | 888                        |
| 4   | `hand: 888,77`; `pass, 888+77`         | 三带二；主三张 8、低附带成本             | 888+77                     |
| 5   | `hand: 完整更大顺子`; `pass, 更大顺子` | 每张被算作顺子损伤，合计 4000；超过 239  | pass                       |
| 6   | `hand: 完整更大连对`; `pass, 更大连对` | 连对损伤合计 2700；超过 239              | pass                       |
| 7   | `hand: 完整更大钢板`; `pass, 更大钢板` | 钢板损伤合计 2000；超过 239              | pass                       |
| 8   | 无普通压制，仅有炸弹                   | 没有非炸弹候选；炸弹不被后置             | 出炸弹（若未触发结构筛除） |
| 9   | `highestSeat=W`; `pass, 任意压制`      | 队友持权提前 return                      | pass                       |
| 10  | `N=1-3`，存在多个压制候选              | 强制阻断；`compareDescending`            | 最大可压牌                 |
| 11  | 对手均剩很多张                         | 普通跟牌；自然对子/三张/三带二按最低成本 | 最小自然结构               |
| 12  | 仅可轻微拆对子压制                     | 拆对子成本 240，超过 239                 | pass                       |
| 13  | 仅可严重拆炸弹或结构                   | 拆炸弹成本 100000，候选被安全筛除        | pass                       |

对于 pass：队友持权是直接规则；普通跟牌中若安全候选为空则是结构阈值导致的规则；高控制对子/三张/三带二的全候选情况由高价值中型结构规则导致。对于最大牌：下家 1-3 张强制阻断的降序候选排序是明确原因。

## 已确认根因与分类

1. **普通领牌委托旧 normal/basic**：大多数领牌并不经过 normal-vNext 独立领牌策略。分类：策略缺失/调用层设计问题；不是产品入口选错机器人。
2. **完整顺子、连对、钢板被误算为拆结构**：完整出牌仍累计结构损伤并被安全门槛排除。分类：bug。
3. **强制阻断选最大可压牌**：候选按降序取首项。分类：候选排序问题。
4. **非单张自然结构缺少独立处理**：对子、三张、三带二有部分支持，顺子、连对、钢板没有。分类：策略缺失。
5. **结构门槛让 pass 成为常见结果**：pass 不是全局默认，但在 `safeCandidates` 为空时立即成为默认。分类：阈值/策略问题。
6. **legalActions 不缺失**：完整枚举、统一验证和稳定排序均在规则层完成。分类：已排除的根因。

## 建议的最小修复顺序（未实施）

1. 先写完整顺子、连对、钢板“整组跟牌不算拆结构”的失败固定牌例。
2. 修正结构损伤计算，并确认非单张跟牌不再被误筛为 pass。
3. 为强制阻断定义最小足够压制排序并固定牌例。
4. 再单独评估是否替换普通领牌对旧 normal/basic 的委托。
5. 最后才进行阈值校准或更广泛策略增强。

## 验证证据

已只读运行：

```text
npm.cmd exec vitest -- run --config core.vitest.config.ts \
  ../packages/guandan-core/src/games/guandan/normal-vnext-bot.test.ts
```

结果：41/41 固定牌例通过。

## 第一批修复记录

状态：已实施并通过回归，未触及普通领牌委托、P5、多人调度或下家 1-3 张强制阻断目标。

### 修复内容

- `structureDamageCost` 改为比较出牌前后自然顺子、连对和钢板的数量；完整且自然地打出一个同类结构可消耗其自身的一次结构损失，不再视为拆结构。
- 若一张牌同时破坏额外的重叠结构，或候选只抽取自然结构的一部分，额外损失仍计入高结构成本。
- 炸弹、大小王、级牌、红桃级牌、对子、三张和三带二的既有成本规则未降低。

### 单张最大牌诊断结论

在下家及所有其他座位均剩 24 张、未命中尾局强阻断、且存在真正散单的 BotView 中，产品 selector 已按最低 `responseCost` 选择最小足够普通散单，不会选择 A、级牌或王。

试玩中的“直接用最大牌”可由较低点候选实际拆对子或破坏重叠自然结构解释：例如拆对子成本为 240，而 A 的点数加控制成本为 134；此时 A 在既有成本模型中确实较低。该情况不是 logical seat、remainingCardCounts、强制阻断触发条件、fallback 顺序或 comparisonKey 方向错误。

### 新增固定牌例与结果

- 完整更大顺子、连对、钢板跟牌均不再 pass。
- 从自然顺子抽取部分牌仍保留至少 800 的结构损伤。
- 普通早中盘多散单时选择最小足够压制；保护对子和自然结构时选择合理散单；有普通散单时不使用 A、级牌或王。
- 下家仅剩三张时仍使用原有强制阻断，并保留较高用牌强度。
- `normal-vnext-bot.test.ts`：50/50 通过（原有 41 项和 P6 新增 9 项）。
