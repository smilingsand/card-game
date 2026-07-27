# P3-11 单人牌桌模块化：审计发现

本文件记录代码审计和验证中的事实；尚未形成结论。

## 2026-07-27：`frontend/src/App.tsx` 初读

- `App.tsx` 的 `App` 仅负责 URL `room` 参数、单人/多人入口切换；`SoloApp` 从第 147 行起承担几乎所有单人适配与牌桌渲染。
- 已独立存在、可直接复用的纯核心能力：`getSelectedPlayActions`、`chooseTableHintAction`、`chooseTableBotAction`、显示顺序算法、公开事件解释、`CardFace` 与 `PlayerCardCount`（后二者目前仍定义在 `App.tsx`）。
- `SoloApp` 仍同时持有：会话创建/恢复/保存、PWA 注册、机器人定时器、回合派生、选牌、理牌、动作提交、贡牌流程、重开、全部四座 JSX 和公开动作 JSX。
- 合法动作匹配没有在 UI 复制规则，使用 `getSelectedPlayActions(game, selectedCardIds)`；出牌按钮使用该结果，过牌由当前人类座位且已有最高牌控制。
- 单人本地机器人调度明确使用 React effect + `window.setTimeout`，并直接调用核心策略和 `applyTableSessionAction`；此机制必须留在单人适配层。
- 当前 `CardFace`、`PlayerCardCount`、公开动作渲染函数和四座布局均与 `TableSession`/`game.cardsById` 直接耦合，尚未形成多人可安全消费的投影 props 边界。

## 2026-07-27：拆分决策与实现边界

- 审计结论：需要拆分。现有核心规则、理牌和公开事件解释已正确位于 `@card-game/guandan-core`，但单人 `SoloApp` 仍把本地状态适配与展示/交互混在同一组件中。
- 已抽离无状态共享候选：`TableView`（牌桌外框）、`SeatView`（座位框）、`CardFace`/`PlayerCardCount`、`PublicActions`、`HandView`、`ActionControls`；以及仅保存选牌实体 ID 的 `useCardSelection`。
- `HandView` 只接收已投影的自己的 `Card[]`、展示分组、选中 ID、可选 ID 和回调；`PublicActions` 只接收已投影的公开牌面。两者均不接收 `TableSession`、全量 `cardsById`、seed、存档或网络状态。
- `SoloApp` 保留单人适配职责：创建/恢复/保存 `TableSession`、将核心数据转换成上述视图 props、进贡流程、重开、PWA、机器人的浏览器定时器与本地规则动作提交。
- TDD tracer：先增加共享 `ActionControls` 的可行动状态测试；模块不存在时测试失败，最小实现后通过。一次重构回归暴露“提示”不应依赖已选牌，现已将 `canHint` 与 `canPlay` 分离并由原有测试覆盖。

## 验证中的环境事件

- Windows 沙箱在一次定向 Vitest 启动时锁住 `frontend/node_modules/.vite-temp` 并报 EPERM；未删除任何文件，受控提升权限重跑后“提示和出牌仍通过规则入口提交”通过。

## 2026-07-27：共享输入合同收口

- 新增 `table-contract.ts`：`TableViewModel`、`TableInteractionCallbacks`、公开动作和手牌分组视图类型，以及逻辑座位到视觉位置的纯映射。
- `TableViewModel` 只包含个人视角的手牌、公开动作、各家余牌数、当前行动者、能力开关、布局和名称；不包含 `TableSession`、`TableGame`、全量 `cardsById`、seed、存档、网络或 Authority。
- `SoloApp` 仍是唯一的本地适配器：它从 `TableSession` 生成该模型，并把核心的合法动作结果匹配为 `onPlay(cardIds)`；共享操作区将原样回传所选实体 ID，不会换成另一合法动作。
- `useCardSelection(ownHandCardIds)` 在个人手牌变化时只清除失效 ID，保留仍有效的选择。
- 视觉映射按固定逻辑顺序 `south → east → north → west` 推导；它只返回 `bottom/right/top/left`，不改写座位或回合顺序。
- 独立合同测试覆盖：原样提交 cardIds、pending 禁止重复提交、按钮能力独立、投影更新清理失效选择、公开动作显式输入边界、座位映射与同 props 的纯展示。
