# P1-05：掼蛋冻结规则固定牌例与测试矩阵

## 目的与执行方式

本矩阵的唯一产品口径是 `docs/resolved-rules.md`、ADR-0011 与 ADR-0012。每个条目在
`frontend/src/games/guandan/rule-cases.ts` 中有同 ID 的固定输入、预期和来源；
`rule-cases.test.ts` 会实际检查 ID 集合、输入、预期、来源和全部规则章节覆盖。

这里不实现牌型识别、比较器、回合状态机或结算逻辑。P1-06 及后续任务须把这些
固定牌例逐项接入规则引擎测试，不得改变其预期或来源。

| ID | 冻结规则/固定情形 | 来源 |
| --- | --- | --- |
| scope-double-deck-four-player | 两副、108 张、四人对家、每家 27 张 | resolved-rules#适用范围 |
| scope-first-round-south-leads | 首局打 2，南家首出 | ADR-0011#决策 |
| scope-heart-level-wildcard | 红桃级牌逢人配且不改原牌面 | resolved-rules#适用范围 |
| pattern-basic-single-pair-triple | 单张、对子、三张及点数比较 | resolved-rules#牌型与比较 |
| pattern-three-with-pair | 三带二只比较三张 | resolved-rules#牌型与比较 |
| pattern-three-consecutive-pairs | 三连对为三组连续对子 | resolved-rules#牌型与比较 |
| pattern-steel-plate | 钢板为两组连续三张 | resolved-rules#牌型与比较 |
| pattern-straight | 五张连续单牌顺子 | resolved-rules#牌型与比较 |
| pattern-normal-bomb | 4-10 张普通炸弹及逢人配 | ADR-0001#决策-3 |
| pattern-straight-flush | 同花顺压五张及以下炸弹 | resolved-rules#牌型与比较 |
| pattern-four-jokers | 四王炸全局最大 | resolved-rules#牌型与比较 |
| compare-normal-following | 普通跟牌限制、炸弹/同花顺跨型 | resolved-rules#牌型与比较 |
| compare-global-hierarchy | 炸弹与同花顺默认层级 | resolved-rules#牌型与比较 |
| compare-rank-and-ace-runs | 单牌顺序及 A 两端连续 | ADR-0001#决策-4 |
| compare-wildcard-interpretations | 多解释、真人/机器人选择 | resolved-rules#牌型与比较 |
| turn-leader-and-response-order | 首局/后续领出与逆时针响应 | resolved-rules#回合与结束 |
| turn-three-passes-clear-round | 三家过牌后的新轮领出 | resolved-rules#回合与结束 |
| turn-partner-catches-wind | 末手出完后的接风 | resolved-rules#回合与结束 |
| turn-finish-order-and-inactive-player | 游次与出完玩家退出行动队列 | resolved-rules#回合与结束 |
| settlement-level-up | 头游方升 1/2/3 级 | resolved-rules#升级、进贡与抗贡 |
| settlement-single-tribute-and-return | 单下进贡及不大于 10 的还贡 | ADR-0001#决策-5 |
| settlement-anti-tribute-proof | 单下/双下抗贡与两王证明 | ADR-0001#决策-6 |
| settlement-double-tribute-and-return | 双下进贡分配和还贡 | resolved-rules#升级、进贡与抗贡 |
| settlement-next-leader | 进贡后首出、同点、抗贡分支 | ADR-0001#决策-2 |
| settlement-level-a-win-and-exclusions | 打 A 胜场与排除附加条款 | resolved-rules#升级、进贡与抗贡 |
| freeze-no-tournament-management | 单机版不含赛事管理条款 | resolved-rules#P0 冻结决议 |

## 当前可执行验证

```powershell
npm.cmd run test:run --prefix frontend -- src/games/guandan/rule-cases.test.ts
```

由于 P1-05 只建立固定牌例，不运行未实现的规则裁决；该测试验证矩阵中的 26 条
规则没有遗漏、重复、空输入/预期或不可追溯来源。
