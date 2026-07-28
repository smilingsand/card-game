# 单人本地掼蛋与多人联机掼蛋：模块复用对照

- 状态：分析稿，尚未据此重构
- 日期：2026-07-27
- 目的：明确 P3 多人实现应复用的单人/共享模块，以及不能直接复用的本地控制逻辑。后续重构不得复制规则或让客户端取得其他座位的隐藏手牌。

## 结论先行

单人与多人应共享的是 `packages/guandan-core` 的规则、牌局会话、合法动作、机器人策略、理牌算法和公开事件解释；不应共享的是单人 `SoloApp` 的本地状态所有权、`setTimeout` 机器人循环、IndexedDB 存档和“南家固定为唯一真人”的假设。

多人正式牌桌可以复用单人页面的纯展示组件和交互组件，但这些组件必须改为只依赖“个人投影 + 回调”，不能读取 `TableSession` 或其他座位的手牌。Authority 仍是动作和状态唯一裁决者。

| 主要模块名称                                    | 模块功能                                                       | 单人游戏：是否使用、限制与使用方式                                                                                                     | 多人游戏：是否使用、限制与使用方式                                                                                                                                                               |
| ----------------------------------------------- | -------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `packages/guandan-core` 规则引擎                | 牌、牌型、比较、回合、合法性和 reducer。                       | 使用；`SoloApp` 直接调用核心创建状态、生成合法动作并应用动作。其完整状态仅在本地浏览器。                                               | 必须使用，且是唯一规则来源；只能由 Authority 持有完整状态并调用。前端不得复制规则判断。                                                                                                          |
| `TableSession` 与事件流                         | 多局比赛状态、等级、进贡/还贡、局号、快照和确定性重放。        | 使用；浏览器创建并保存 `TableSession`，可序列化到 IndexedDB。                                                                          | 必须使用；Authority 创建、重放和持久化 `TableSession`。客户端只接收个人投影，不能接收 session、seed、快照或全量事件内部数据。                                                                    |
| `applyTableSessionAction` / `submitTableAction` | 对 `TurnAction` 执行统一验证、应用并生成事件。                 | 使用；人类和本地机器人都通过它提交动作。                                                                                               | 必须使用；真人 HTTP/WS 意图和机器人内部命令最终都必须进入此路径。Room 不能直接修改权威牌局状态。                                                                                                 |
| `getSelectedPlayActions` / `getLegalBotActions` | 将选中的实体牌 ID 匹配为完整合法动作；枚举当前座位的合法动作。 | 使用；单人 UI 用选牌结果决定“出牌”可用性，机器人用完整合法动作选招。                                                                   | 应直接使用；Authority 在个人投影中给当前真人下发该座位的完整合法动作。多人 UI 只能用该列表匹配选牌，不能用“首张牌”或自行简化牌型。                                                               |
| `chooseTableBotAction` / `normal-vNext`         | 基于 `BotView` 和合法动作选择机器人动作。                      | 使用；`SoloApp` 对当前非南家座位调用，随后经统一 reducer 应用。                                                                        | 必须使用；Authority 仅为当前机器人座位构造 `BotView`，经内部幂等命令和同一 reducer 提交。不得把对手手牌交给策略或由前端替机器人裁决。                                                            |
| 机器人思考节奏与轮转                            | 在一个动作结束后推进下一位机器人。                             | 使用；`SoloApp` 的 React effect + `setTimeout(botThinkDelayMs)` 控制，因全部状态在同一页面，可直接推进。                               | 必须重写为 Room/Authority 调度；使用持久化时钟、动作边界、心跳和 Alarm。不得复用单人 effect 或浏览器定时器，否则会破坏断线托管、幂等和服务端权威。                                               |
| 人类选牌、提示和按钮状态                        | 多选手牌、判断可出/可过、提交出牌或过牌。                      | 使用；读取本地完整 `TableGame`，由 `getSelectedPlayActions` 得到按钮状态；提示也由本地策略产生。                                       | 可复用交互外壳和核心匹配函数；输入必须来自个人 `legalActions` 投影，提交只发送 `cardIds` / `pass`、`clientCommandId` 和 Authority 事件序号。不得传 actor、seat、seed 或完整状态。                |
| 手牌排序、横竖排、拖拽、键盘理牌                | 按牌面分组、横竖布局、拖拽/Alt+方向键调整仅本人的显示顺序。    | 使用 `display-order.ts`、`groupHumanDisplayCards`、`moveHumanDisplayCard` 和 `reconcileHumanDisplayOrder`；偏好写入本地 session 存档。 | 应直接复用算法；多人仅保存当前浏览器自己的显示偏好，不能把理牌顺序写入权威规则事件，也不能影响其他玩家。                                                                                         |
| 牌面组件 `CardFace` 与公开出牌渲染              | 渲染一张牌、级牌标识、配牌解释、过牌和桌面最近动作。           | 使用；可读取本地 `cardsById`、所有公开事件，明牌模式还能显示所有手牌。                                                                 | 可复用为无状态展示组件；输入必须是个人手牌或 Authority 明确投影出的公开牌面。不能从其他玩家手牌或全量 `cardsById` 推断隐藏信息；多人不能提供单人“明牌”能力。                                     |
| 牌桌布局、座位映射和名称                        | 在桌面上显示上下左右、手牌数、队友和出牌。                     | 使用固定 `south` 真人、其余三家机器人，布局和逻辑座位一致。                                                                            | 可复用 CSS token、牌桌尺寸和展示结构；必须使用 ADR-0029 的个人视觉投影：`bottom=self`、`left=upstream`、`right=downstream`、`top=teammate`。逻辑座位不随屏幕旋转；显示实际玩家名或稳定机器人名。 |
| 最近动作/当前最高牌                             | 显示领出牌、压制牌、过牌和清空后的桌面信息。                   | 使用 `publicEvents`、`actionFromPublicEvent`、`latestRecentActionsBySeat` 等共享解释工具。                                             | 应复用共享公开事件解释；Authority 在个人投影中给出公开事件和当前最高牌面。UI 不能从其他数据拼出公开牌，也不能误把后续机器人的事件归为真人动作。                                                  |
| 个人投影与隐藏信息边界                          | 决定一个观察者能读取哪些状态。                                 | 不需要网络投影；浏览器本地持有全局状态，开发明牌仅限单机。                                                                             | 必须重写为 Authority 投影函数；只下发本人手牌、公开事件、各家剩余张数、当前座位、个人合法动作和视觉座位映射。禁止下发 seed、对手手牌、机器人评估和全量状态。                                     |
| 房间、身份、座位和房主                          | 创建/加入房间、邀请码、控制者绑定、准备和重开授权。            | 不使用；只有本机南家，无账号和房间。                                                                                                   | 必须新增并保留 Room/AuthSession；以 `(roomId, seat, controllerSubjectId)` 绑定控制权，服务端验证房主重开权限。不能从单人模块复用。                                                               |
| WebSocket、ACK、重连、心跳和断线托管            | 同步失效通知、命令幂等、补发、超时和机器人接管。               | 不使用；页面内部状态变化不需要协议或重连。                                                                                             | 必须新增并保留 RealtimeRoom/Room 协调；协议序号与 Authority 事件序号需明确分离，所有托管动作仍经 Authority。不能复用单人定时 effect。                                                            |
| 存档、备份和恢复                                | 保存局面并恢复到一致状态。                                     | 使用 IndexedDB；只处理本机浏览器数据，失败可由用户重开。                                                                               | 必须使用 SQLite-backed Durable Object 事件/快照以及 JSONL 备份恢复；恢复期间拒绝动作。IndexedDB 只能存 UI 偏好，不能做多人权威存档。                                                             |
| 重开本局/重新开赛                               | 重置当前局或整场比赛。                                         | 使用 `restartCurrentTableSession` / `createTableSession`，本机可直接触发。                                                             | 核心会话函数应复用；Room 必须先验证房主，Authority 生成新 gameId 和安全 seed 并持久化。客户端只发重开意图。                                                                                      |
| 测试                                            | 固定牌例、规则回归、机器人对局和界面交互。                     | 使用核心单元测试与 React 组件测试；允许完整本地状态 fixture。                                                                          | 继续复用核心固定牌例；另需 Miniflare 权威黑盒、个人投影泄露、ACK 幂等、断线/托管、重启恢复和多客户端浏览器验收。不能用单人全状态 fixture 绕过 Authority。                                        |

## 建议的重构边界

1. 把单人牌桌 UI 中与状态来源无关的内容拆为共享展示/交互组件：`CardFace`、公开动作层、手牌分组区、选牌控制、桌面座位框架。
2. 该共享组件仅接收显式 props：`ownHand`、`legalActions`、`publicEvents`、`highestPlay`、`remainingCardCounts`、`positions`、`canAct` 和动作回调；禁止接收 `TableSession`、`TableGame`、`cardsById` 全量映射或其他座位手牌。
3. 单人适配器继续从本地 `TableSession` 组装这些 props；多人适配器只从 Authority 个人投影组装相同 props。
4. 所有规则判定、机器人决策和比赛状态变更仍留在 `guandan-core`；多人只能把其执行位置从浏览器本地适配器换为 Authority，不应复制实现。
5. 房间、身份、实时协议、心跳、断线托管、事件持久化和恢复属于多人专属适配层，不能为了“复用单人”而移回 React 页面。

## 现有代码定位

- 单人本地适配与页面：`frontend/src/App.tsx`
- 多人页面与 HTTP/WS 客户端：`frontend/src/multiplayer/MultiplayerApp.tsx`、`frontend/src/multiplayer/client.ts`
- 共享牌局会话、规则、机器人和理牌：`packages/guandan-core/src/games/guandan/`
- 多人权威执行：`backend/src/authority-game.ts`
- 房间、控制权和托管调度：`backend/src/room.ts`
- 多人座位/个人投影约束：`proj-info/adr/ADR-0029-p3-seat-controller-and-view-projection.md`
