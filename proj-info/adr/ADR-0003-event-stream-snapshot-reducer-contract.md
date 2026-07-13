# ADR-0003：事件流、快照与纯 reducer 合约

- 状态：已接受
- 日期：2026-07-13
- 决策人：开发团队

## 背景

P1-04 需要为之后的规则引擎与本地存档建立可重放的事件边界。事件 schema、快照锚点和 reducer 失败语义会进入存档格式，必须在实现前冻结。

## 决策

1. 版本化事件流是游戏事实来源。每个流具有 `schemaVersion`、`rulesVersion` 和从 `0` 开始连续递增的 `sequence`；事件以 `{ sequence, type, actorId?, payload }` 表示。`type` 为游戏或平台定义的稳定词表项，`payload` 只能包含可序列化事实，不能包含函数、时间或隐藏随机数。
2. P1 的平台基础词表保留 `game.created`、`action.applied`、`game.completed`。具体游戏在自己的插件边界扩充词表；公共 `platform` 不导入也不枚举掼蛋事件。
3. 事件流为 append-only 值对象：追加返回新流和新的只读事件数组；写入时必须对整个事件作结构化深复制和深冻结，不得修改既有流或已写入事件。只能在 `sequence` 恰为当前事件数、schema/rules 版本匹配时追加。
4. 快照记录 `{ schemaVersion, rulesVersion, eventSequence, state }`，其中 `eventSequence` 是包含在快照中的最后一个事件序号，空流快照为 `-1`。创建快照时必须对 state 作结构化深复制和深冻结；快照仅是恢复加速索引，不能替代事件流。
5. reducer 是纯函数：`initialState(seed)` 后按事件顺序调用 `applyEvent` 可重建状态。动作先经 `validateAction`；非法动作不调用 `applyAction`，返回同一状态引用及受控错误，且不追加事件。

## 后果

- 任意 schema、规则版本、序列号或词表语义的不兼容变更必须新增 ADR，并使旧存档显式拒绝或迁移，不能静默重放。
- `seed + events` 始终可从初始状态完整重建；若使用快照，只能回放其后连续事件。
- 本 ADR 不定义任何掼蛋出牌、牌型或结算事件；这些须由后续任务在游戏插件层定义。
