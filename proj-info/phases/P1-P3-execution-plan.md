# P1-P3 子任务分解与执行计划

## 使用规则

- 状态仅可按 `not_started → in_progress → ready_for_acceptance → accepted` 前进；`blocked` 必须写明阻塞原因和下一步。
- 只启动依赖全部为 `accepted` 的最小任务；一个 session 默认只推进一个任务。
- “测试条件”是最低门槛，“验收标准”必须有命令输出、固定 seed、截图或发布记录可追溯。
- P0 未关闭 `docs/resolved-rules.md` 中所有待确认项前，P1-01 不得开始。

## P1：单人本地掼蛋 MVP

| ID    | 依赖                                            | 开发内容                                                                                      | 测试条件                                  | 验收标准                                                                            | 当前状态    |
| ----- | ----------------------------------------------- | --------------------------------------------------------------------------------------------- | ----------------------------------------- | ----------------------------------------------------------------------------------- | ----------- |
| P1-01 | P0 规则冻结（本次仅工程初始化，获用户明确授权） | 初始化 `frontend/`、严格 TS、Vitest、格式化、lint、基础 CI；配置 Vercel Root Directory 预案。 | 空项目构建、typecheck、lint、单测各一次。 | 本地与 CI 全绿；无产物写入根目录。                                                  | accepted    |
| P1-02 | P1-01                                           | 实现 Card、Suit、Rank、Seat、Team、Player、Action、Event 等公共类型。                         | 类型级测试和编译。                        | 平台层不导入游戏专属类型；每张牌可由唯一 ID 标识。                                  | accepted    |
| P1-03 | P1-02                                           | 多副牌生成、带 seed 洗牌、四人发牌和牌组守恒校验。                                            | 固定 seed + 随机 10,000 次发牌。          | 108 张无重复/丢失；每家 27 张；同 seed 可重放。                                     | accepted    |
| P1-04 | P1-02                                           | 事件词表、append-only 事件流、快照和纯 reducer 基础。                                         | 重放测试、非法动作不变性测试。            | `seed + events` 可重建状态；失败动作不污染状态。                                    | accepted    |
| P1-05 | P1-02                                           | 将 `resolved-rules` 每条实现规则转为固定牌例和测试矩阵。                                      | 逐条执行牌例。                            | 无缺失规则条目；每个牌例包含输入、预期和来源。                                      | accepted    |
| P1-06 | P1-03, P1-05                                    | 牌型识别与逢人配多解释枚举。                                                                  | 全牌型、边界、歧义手牌测试。              | 合法解释完整且不改动原 Card；非法组合有明确错误码。                                 | accepted    |
| P1-07 | P1-06                                           | 牌型比较器、跨牌型炸弹/同花顺和跟牌限制。                                                     | 固定比较矩阵、性质测试。                  | 与 `guandan-v1` 排序一致；不可比较时拒绝。                                          | accepted    |
| P1-08 | P1-04, P1-07                                    | 出牌、过牌、轮转、清轮、接风和出完顺序状态机。                                                | 典型局面、全过、队友接风和末手测试。      | 无已出完玩家再次行动；每局总能到结算或给出受控错误。                                | accepted    |
| P1-09 | P1-08                                           | 进贡、还贡、抗贡、升级、打 A 胜负和下一局初始化。                                             | 单下/双下/抗贡/升 1-3 级牌例。            | 规则版本化；每种结算产出可重放事件。                                                | accepted    |
| P1-10 | P1-08                                           | 定义 `BotView`、公开记牌和合法动作生成器。                                                    | 类型边界与信息泄露测试。                  | Bot API 无对手手牌/洗牌 seed 字段；所有合法动作都经规则引擎验证。                   | accepted    |
| P1-11 | P1-10                                           | 初级机器人启发式：最小代价压制、少拆组合、不随意压队友、尾盘拦截。                            | 固定策略局面。                            | 选择动作均合法、确定、在规定思考时限内。                                            | accepted    |
| P1-12 | P1-09, P1-11                                    | 自动对局模拟器、异常不变量与 seed 失败复现。                                                  | 1,000 局；记录首个失败 seed。             | 0 非法动作、死循环、重复牌、负牌数或无法结算。                                      | accepted |
| P1-13 | P1-08                                           | 桌面牌桌、选牌、排序、出牌/过牌/提示、错误提示和规则入口。                                    | 浏览器组件/E2E 冒烟。                     | 人类可完成一局；UI 不含规则判断副本。                                               | accepted |
| P1-14 | P1-04, P1-13                                    | IndexedDB 自动保存、继续/新局/清除和版本检查。                                                | 刷新、中断恢复、旧版本拒绝/迁移测试。     | 恢复后状态、事件与机器人公开记忆一致。                                              | accepted |
| P1-15A | P1-11 | 修复初级机器人对非队友领出牌的压制选择；补固定牌例与浏览器轮转回归。 | 机器人可压制/不可压制/对家领出三类牌例。 | 对手领出且存在合法压制时，机器人不会无条件过牌；所有动作仍由规则引擎验证。 | accepted |
| P1-15B | P1-13, P1-14 | 手牌首次自动整理和手动理牌：按确定性牌面分组/排序展示，支持拖拽移动，保存仅限自己的显示顺序。 | 排序、拖拽、刷新恢复和不改变出牌实体 ID 的组件/浏览器测试。 | 首次打开即易读；手动位置可恢复；理牌不改变规则状态、事件流或机器人视图。 | accepted |
| P1-15C | P1-13, P1-15A | 标准桌面方位：北上、南下、西左、东右；真人固定为南座，首局仍由东座领出；中央展示当前轮最高公开出牌。 | 四座布局/真人南座/东座机器人首出/最高出牌与清轮组件和浏览器测试。 | 真人位于下方；左西右东与规则座位一致；首局领出规则不变；最高公开出牌在清轮后消失。 | accepted |
| P1-16 | P1-12, P1-14, P1-15A, P1-15B, P1-15C | PR Preview、生产部署、回滚演练与发布记录。 | CI 全量 + Preview 人工冒烟。 | GitHub `main` 对应 Vercel Production 可玩；`release.md` 含 URL、commit 和回滚目标。 | not_started |

### P1-12 自测记录（2026-07-13）

- 命令：`npm.cmd run test:run -- turns.test.ts simulation.test.ts`（在 `frontend/` 执行）。结果：6 tests passed；`runSimulationBatch({ startSeed: 0, gameCount: 1_000 })` 在约 31 秒内完成，`firstFailureSeed` 为 `undefined`。
- 命令：`npm.cmd run typecheck`、`npm.cmd run lint`、`npm.cmd run test:run`。结果：均通过；全量 Vitest 为 12 files / 44 tests passed。
- 模拟器对每次动作经 `validateAction` 后再 `applyAction`，并在每个动作前后检查实体牌守恒与唯一性、非负手牌、1,000 动作上限和可结算性。批量运行按递增 seed 执行；若失败，返回的 `firstFailureSeed` 可直接传入 `runSimulation(seed)` 重放。
- 自测曾在 seed `2` 的第 `251` 个动作复现“已完成对家接风”的状态机缺陷；已增加 `turns.test.ts` 回归牌例并修复为跳过已完成座位。修复后 seed 0–999 无失败。

### P1-13 自测记录（2026-07-13）

- 命令：在 `frontend/` 执行 `npm.cmd run format:check`、`npm.cmd run typecheck`、`npm.cmd run lint`、`npm.cmd run test:run`、`npm.cmd run build`。结果：全部通过；全量 Vitest 为 12 files / 46 tests passed，生产构建成功。
- 组件回归：`src/App.test.tsx` 覆盖规则入口、27 张唯一实体牌的选择、提示后出牌及机器人轮转，以及人类仅用提示、出牌、过牌完成一局。整局流程在全量并行测试下约 5 秒，显式测试预算为 15 秒。
- 真实浏览器冒烟：使用临时 `npx --package @playwright/cli` 访问本机 Vite 页面，确认规则入口、提示、出牌；出牌后东家从 27 张变为 26 张并经机器人回合回到东家。未向项目添加 Playwright 依赖，生成的 `.playwright-cli/` 临时快照已删除。
- UI 边界：`table-controller.ts` 仅用 `recognizePatterns` 生成候选动作，再经 `getLegalActions`、`validateAction` 和 `applyAction`；组件不复制牌型、跟牌或回合裁决逻辑。

### P1-14 自测记录（2026-07-13）

- 存档格式：`saveSchemaVersion=1`、P1-04 `schemaVersion=1`、`rulesVersion=guandan-v1`，并保存 seed、append-only `action.applied` 事件流与覆盖完整事件流的快照。恢复时从 seed 完整重放，逐项比对快照状态和公开事件；任一 schema/rules 版本不匹配、快照锚点不完整或事件非法均显式拒绝，P1 不提供迁移。
- 命令：在 `frontend/` 执行 `npm.cmd run format:check`、`npm.cmd run typecheck`、`npm.cmd run lint`、`npm.cmd run test:run`、`npm.cmd run build`。结果：全部通过；Vitest 为 14 files / 51 tests passed，生产构建成功。
- 回归：`table-session.test.ts` 覆盖中断后完整重放、快照/事件/机器人公开记忆一致及旧 rulesVersion 拒绝；`App.test.tsx` 用可注入内存存储覆盖继续中断对局、新局和清除入口，以及不兼容存档提示后不自动覆盖、仅在用户明确选择新局后才写入；`storage.test.ts` 覆盖无 IndexedDB 时延迟失败，确保存储边界 SSR-safe。未增加测试依赖。
- 浏览器：主验收以临时 Playwright CLI 在本机 Vite Preview 完成“提示→出牌→刷新”：刷新后页面显示“已继续上次未完成的对局”，东家手牌保持 26 张。未向项目添加 Playwright 依赖，生成的 `.playwright-cli/` 临时快照已删除。

### P1-15 补丁计划（2026-07-13）

- 用户反馈驱动的发布前修正，不修改 P1-01 至 P1-14 的 accepted 任务内容。原 P1-15 部署任务顺延为 P1-16；P2-01 的依赖同步改为 P1-16。
- P1-15A 诊断：`basic-bot.ts` 对 `pass` 给出低于任何出牌的评分，因此在非尾盘总会优先过牌；修复必须维持 BotView 信息边界和统一规则入口。
- P1-15A 自测（2026-07-13）：对手领出且有合法压制时将 `pass` 排至出牌之后；对家领出仍优先 `pass`，无可压制牌仍可 `pass`，尾盘拦截策略保持。`table-controller.test.ts` 用东家领出、南家有真实可压制单张的规则状态验证机器人接牌；`App.test.tsx` 覆盖该存档恢复后的机器人轮转。`npm.cmd run format:check`、`npm.cmd run typecheck`、`npm.cmd run lint`、`npm.cmd run test:run`（15 files / 54 tests，41.72s）和 `npm.cmd run build` 均通过。
- P1-15B 的显示顺序不属于规则状态。由于它会进入版本化本地存档，先写 ADR 确定 UI 偏好数据与规则事件流的隔离，再实现。
- P1-15B 自测（2026-07-13）：ADR-0010 定义 `humanDisplayOrder` 为仅真人 UI 偏好；存档升至 `saveSchemaVersion=2`，恢复仍接受 P1-14 的 v1 存档并回退默认排序。`display-order.test.ts` 覆盖按点数/级牌/大小王的确定性布局、出牌 ID 移除和仅重排实体 ID；`table-session.test.ts` 覆盖偏好与事件/快照隔离、v1 兼容和出牌后的恢复；`App.test.tsx` 覆盖拖拽、刷新恢复、实体牌选择和 Alt 加方向键回退。`npm.cmd run format:check`、`npm.cmd run typecheck`、`npm.cmd run lint`、`npm.cmd run test:run`（16 files / 61 tests）和 `npm.cmd run build` 均通过。真实 Playwright 冒烟：将大王拖到第一张前，状态提示“已调整手牌显示顺序。”；刷新后显示“已继续上次未完成的对局。”且大王仍是第一张（27 张），未产生规则动作。临时 Playwright/Vite 产物已清理。
- P1-15C 将人类控制权从东座移至南座，但首局仍由东座领出；东座机器人必须通过同一动作路径完成首出。
- P1-15C 自测（2026-07-13）：`App.tsx` 固定真人为南座；视觉网格将北座置顶、西座置左、东座置右，真人手牌与操作区处于牌桌下方。四座均显示名称和剩余手牌数，桌面中央显示当前行动与上手信息，并仅从公开 `action.applied` 事件中反向提取当前 `highestSeat` 的出牌实体 ID 后显示牌面；不读取其他玩家手牌。`highestSeat` 在三名下家过牌清轮后清空，最高出牌区域随之隐藏。东座首轮由既有 `chooseTableBotAction`（仅接收 `BotView`）选择动作，再经 `applyTableSessionAction` 统一规则边界提交；规则座位轮次仍为 east → south → west → north。`table-controller.test.ts` 覆盖东座机器人首出并进入南座；`App.test.tsx` 覆盖四座布局、东座从 27 张变为 26 张后轮到南座真人以及最高公开出牌显示；`table-session.test.ts` 覆盖南座显示顺序在恢复后保持、清轮状态及最高出牌清空。`npm.cmd run format:check`、`npm.cmd run typecheck`、`npm.cmd run lint` 均通过，定向 `npm.cmd run test:run -- --configLoader runner App.test.tsx table-session.test.ts` 为 2 files / 13 tests passed，全量 `npm.cmd run test:run -- --configLoader runner` 为 16 files / 63 tests passed。普通 Vitest 配置加载及 `vite build` 清理共享输出目录时遭 Windows EPERM 文件锁；使用 `--configLoader runner` 已完成配置加载与测试。独立 Vite 开发服务在 `127.0.0.1:5175` 返回 HTTP 200；Playwright CLI 临时运行环境无输出而停止，待主验收在无共享进程锁时补真实浏览器冒烟。

## P2：移动/PWA 与策略机器人

| ID    | 依赖         | 开发内容                                               | 测试条件                         | 验收标准                                            | 当前状态    |
| ----- | ------------ | ------------------------------------------------------ | -------------------------------- | --------------------------------------------------- | ----------- |
| P2-01 | P1-16        | 响应式牌桌、横屏优先布局、安全区与触摸选牌。           | Playwright 手机视口 + 真机抽测。 | Android Chrome、iPhone Safari 可完成核心回合。      | not_started |
| P2-02 | P2-01        | Manifest、Service Worker、离线壳与版本升级提示。       | 离线/升级/缓存清理测试。         | 安装后可离线启动；不以旧缓存运行新规则版本。        | not_started |
| P2-03 | P1-12        | 手牌结构、手数、主攻/助攻、公开大牌统计和置信度模型。  | 固定牌力/过牌样例。              | 推断与确定事实分层；不泄露隐藏牌。                  | not_started |
| P2-04 | P2-03        | 普通难度评分机器人、队友协同、炸弹策略和局面阶段权重。 | 固定策略局 + 固定 seed 对局。    | 机器人选择可解释；不频繁无意义压队友。              | not_started |
| P2-05 | P2-04        | 初级/普通机器人对测、性能预算与回归基线。              | 10,000 局、移动端性能样本。      | 普通难度对初级有稳定指标提升；不超过思考预算。      | not_started |
| P2-06 | P2-02, P2-05 | P2 Preview/Production 发布与 PWA 验收记录。            | 全量 CI、离线 E2E、真机清单。    | Vercel Production 完成 PWA/移动验收，保留回滚版本。 | not_started |

## P3：多人联网掼蛋

| ID    | 依赖                | 开发内容                                                         | 测试条件                                       | 验收标准                                                      | 当前状态    |
| ----- | ------------------- | ---------------------------------------------------------------- | ---------------------------------------------- | ------------------------------------------------------------- | ----------- |
| P3-01 | P2-06               | 实时架构 ADR 与 POC：托管实时服务/常驻后端比较。                 | 4 客户端连接、断连和成本/时限测量。            | 选型记录包含 Hobby 合规、连接上限、数据归属、恢复和退出方案。 | not_started |
| P3-02 | P3-01               | `backend/` 工程、健康检查、配置 schema、匿名身份与轮换重连令牌。 | 配置校验、令牌失效/轮换测试。                  | 无密钥入库；服务可健康探测并最小权限运行。                    | not_started |
| P3-03 | P3-02, P1-09        | 服务端权威牌局、个人视图投影和动作幂等键。                       | 恶意动作、重复请求、投影快照测试。             | 客户端不可决定洗牌/出牌/机器人；响应不含对手手牌或 seed。     | not_started |
| P3-04 | P3-03               | 创建/加入/座位/准备/开始/空位机器人房间生命周期。                | 多房间并发、满房、重复加入测试。               | 支持 1-4 真人且状态转移可审计。                               | not_started |
| P3-05 | P3-03               | 实时事件协议、顺序号、ack、重放和客户端状态同步。                | 乱序、重复、延迟和重连模拟。                   | 客户端最终与服务端同序列一致，无重复执行。                    | not_started |
| P3-06 | P3-04, P3-05        | 超时、断线等待、机器人托管和安全交接。                           | 刷新/断网/回归/并发接管测试。                  | 仅在动作边界交接；重连玩家恢复原座位和个人视图。              | not_started |
| P3-07 | P3-03               | 房间/事件持久化、快照、TTL 和恢复。                              | 服务重启、损坏快照、过期房间测试。             | 未过期对局可恢复；过期数据按策略删除且可审计。                | not_started |
| P3-08 | P3-03, P3-05        | 权限、速率限制、输入 schema、信息泄露与日志脱敏。                | 四个视角抓包、模糊输入、压力样本。             | 0 他人手牌/seed 泄露；异常请求被拒绝并有安全日志。            | not_started |
| P3-09 | P3-02, P3-07        | 结构化日志、指标、告警阈值、备份与恢复演练。                     | 故障注入、恢复演练。                           | 可定位房间/事件而不记录敏感牌面；恢复目标有实测证据。         | not_started |
| P3-10 | P3-06, P3-08, P3-09 | 端到端多人回归与网络混沌测试。                                   | 1-4 真人、机器人补位、断线、重连、超时全矩阵。 | 所有 P3 场景通过；发现问题可由 room/event/seed 重放。         | not_started |
| P3-11 | P3-10               | 前端 Vercel 发布、后端部署、Preview/Production 验收和回滚。      | 生产模拟房、健康检查、日志扫描。               | 前端在 Vercel Hobby；后端选型合规且 `release.md` 完整。       | not_started |
