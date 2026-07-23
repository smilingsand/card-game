# P1-P3 子任务分解与执行计划

## 使用规则

- 活动任务状态仅可按 `not_started → in_progress → ready_for_acceptance → accepted` 前进；`blocked` 必须写明阻塞原因和下一步。`revoked` 仅用于已归档且不可执行的历史任务。
- 只启动依赖全部为 `accepted` 的最小任务；一个 session 默认只推进一个任务。
- “测试条件”是最低门槛，“验收标准”必须有命令输出、固定 seed、截图或发布记录可追溯。
- P0 未关闭 `docs/resolved-rules.md` 中所有待确认项前，P1-01 不得开始。

## P1：单人本地掼蛋 MVP

| ID     | 依赖                                                                                                                                                       | 开发内容                                                                                                | 测试条件                                                          | 验收标准                                                                                                                     | 当前状态 |
| ------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------- | -------- |
| P1-01  | P0 规则冻结（本次仅工程初始化，获用户明确授权）                                                                                                            | 初始化 `frontend/`、严格 TS、Vitest、格式化、lint、基础 CI；配置 Vercel Root Directory 预案。           | 空项目构建、typecheck、lint、单测各一次。                         | 本地与 CI 全绿；无产物写入根目录。                                                                                           | accepted |
| P1-02  | P1-01                                                                                                                                                      | 实现 Card、Suit、Rank、Seat、Team、Player、Action、Event 等公共类型。                                   | 类型级测试和编译。                                                | 平台层不导入游戏专属类型；每张牌可由唯一 ID 标识。                                                                           | accepted |
| P1-03  | P1-02                                                                                                                                                      | 多副牌生成、带 seed 洗牌、四人发牌和牌组守恒校验。                                                      | 固定 seed + 随机 10,000 次发牌。                                  | 108 张无重复/丢失；每家 27 张；同 seed 可重放。                                                                              | accepted |
| P1-04  | P1-02                                                                                                                                                      | 事件词表、append-only 事件流、快照和纯 reducer 基础。                                                   | 重放测试、非法动作不变性测试。                                    | `seed + events` 可重建状态；失败动作不污染状态。                                                                             | accepted |
| P1-05  | P1-02                                                                                                                                                      | 将 `resolved-rules` 每条实现规则转为固定牌例和测试矩阵。                                                | 逐条执行牌例。                                                    | 无缺失规则条目；每个牌例包含输入、预期和来源。                                                                               | accepted |
| P1-06  | P1-03, P1-05                                                                                                                                               | 牌型识别与逢人配多解释枚举。                                                                            | 全牌型、边界、歧义手牌测试。                                      | 合法解释完整且不改动原 Card；非法组合有明确错误码。                                                                          | accepted |
| P1-07  | P1-06                                                                                                                                                      | 牌型比较器、跨牌型炸弹/同花顺和跟牌限制。                                                               | 固定比较矩阵、性质测试。                                          | 与 `guandan-v1` 排序一致；不可比较时拒绝。                                                                                   | accepted |
| P1-08  | P1-04, P1-07                                                                                                                                               | 出牌、过牌、轮转、清轮、接风和出完顺序状态机。                                                          | 典型局面、全过、队友接风和末手测试。                              | 无已出完玩家再次行动；每局总能到结算或给出受控错误。                                                                         | accepted |
| P1-09  | P1-08                                                                                                                                                      | 进贡、还贡、抗贡、升级、打 A 胜负和下一局初始化。                                                       | 单下/双下/抗贡/升 1-3 级牌例。                                    | 规则版本化；每种结算产出可重放事件。                                                                                         | accepted |
| P1-10  | P1-08                                                                                                                                                      | 定义 `BotView`、公开记牌和合法动作生成器。                                                              | 类型边界与信息泄露测试。                                          | Bot API 无对手手牌/洗牌 seed 字段；所有合法动作都经规则引擎验证。                                                            | accepted |
| P1-11  | P1-10                                                                                                                                                      | 初级机器人启发式：最小代价压制、少拆组合、不随意压队友、尾盘拦截。                                      | 固定策略局面。                                                    | 选择动作均合法、确定、在规定思考时限内。                                                                                     | accepted |
| P1-12  | P1-09, P1-11                                                                                                                                               | 自动对局模拟器、异常不变量与 seed 失败复现。                                                            | 1,000 局；记录首个失败 seed。                                     | 0 非法动作、死循环、重复牌、负牌数或无法结算。                                                                               | accepted |
| P1-13  | P1-08                                                                                                                                                      | 桌面牌桌、选牌、排序、出牌/过牌/提示、错误提示和规则入口。                                              | 浏览器组件/E2E 冒烟。                                             | 人类可完成一局；UI 不含规则判断副本。                                                                                        | accepted |
| P1-14  | P1-04, P1-13                                                                                                                                               | IndexedDB 自动保存、继续/新局/清除和版本检查。                                                          | 刷新、中断恢复、旧版本拒绝/迁移测试。                             | 恢复后状态、事件与机器人公开记忆一致。                                                                                       | accepted |
| P1-15A | P1-11                                                                                                                                                      | 修复初级机器人对非队友领出牌的压制选择；补固定牌例与浏览器轮转回归。                                    | 机器人可压制/不可压制/对家领出三类牌例。                          | 对手领出且存在合法压制时，机器人不会无条件过牌；所有动作仍由规则引擎验证。                                                   | accepted |
| P1-15B | P1-13, P1-14                                                                                                                                               | 手牌首次自动整理和手动理牌：按确定性牌面分组/排序展示，支持拖拽移动，保存仅限自己的显示顺序。           | 排序、拖拽、刷新恢复和不改变出牌实体 ID 的组件/浏览器测试。       | 首次打开即易读；手动位置可恢复；理牌不改变规则状态、事件流或机器人视图。                                                     | accepted |
| P1-15C | P1-13, P1-15A                                                                                                                                              | 标准桌面方位：北上、南下、西左、东右；真人固定为南座，首局仍由东座领出；中央展示当前轮最高公开出牌。    | 四座布局/真人南座/东座机器人首出/最高出牌与清轮组件和浏览器测试。 | 真人位于下方；左西右东与规则座位一致；首局领出规则不变；最高公开出牌在清轮后消失。                                           | accepted |
| P1-15D | P1-15B, P1-15C                                                                                                                                             | 各座公开出牌贴近对应座位展示；增加本地测试“明牌”开关，按整理顺序显示/隐藏其他三家手牌。                 | 四座出牌位置、清轮清除、明牌开关与隐藏恢复组件/浏览器测试。       | 公开牌仅来自已提交动作并随清轮消失；默认不泄露他人手牌，明牌关闭后立即隐藏；开关不进入规则事件或 BotView。                   | accepted |
| P1-15E | P1-15A                                                                                                                                                     | 修正规则轮转为逆时针东→北→西→南，并让机器人枚举可压制的非单张牌型。                                     | 轮转牌例；三带二等跟牌牌例；自动对局与浏览器回归。                | 规则轮转符合冻结口径；存在合法同牌型压制时机器人可接牌，不再只因候选集仅含单张而过牌。                                       | accepted |
| P1-16A | P1-15B, P1-15C, P1-15D, P1-15E                                                                                                                             | 发布前桌面修正：南家首局领出、浅色方桌与四边玩家、方式 A 的手牌整理、牌面/出牌/最近四手展示及操作样式。 | 规则固定牌例、组件测试、全量回归、浏览器人工冒烟。                | 新规则版本不重解释旧存档；首局南家先出；四家与明牌均按可读布局展示；手动理牌和统一规则校验保持有效。                         | accepted |
| P1-16B | P1-16A                                                                                                                                                     | 发布前桌面修正二：南家区域移入牌桌下半部；手牌纵横叠放/横排切换；理牌后保持当前布局。                   | 组件测试、全量回归、浏览器人工冒烟。                              | 南家操作、手牌、说明和数量均在桌内；默认纵横叠放，切换与理牌前后一致；明牌同步采用当前手牌布局。                             | accepted |
| P1-16C | P1-16B                                                                                                                                                     | 发布前桌面修正三：牌面锚点、无分割纵叠、横排自动两行、南家操作/出牌垂直间距。                           | 组件测试、全量回归、浏览器人工冒烟。                              | 纵横叠放的点数/花色位置统一且无分割线；横排过长自动两行；操作紧贴手牌上方；南家公开出牌下移。                                | accepted |
| P1-16D | P1-16C                                                                                                                                                     | 发布前桌面修正四：南家公开出牌与操作按钮建立不重叠的安全间距。                                          | 组件测试、全量回归、浏览器人工冒烟。                              | 南家公开出牌的下缘略高于操作按钮上缘，所有手牌布局下均不重叠。                                                               | accepted |
| P1-16E | P1-16D                                                                                                                                                     | 机器人策略修正：三带二主组三张比较、级牌不低配、领出不拆完整同点数牌组。                                | 固定牌例、机器人策略测试、自动对局与浏览器回归。                  | 三带二只比较主三张；非残局级牌不低配；机器人领出完整三张而不拆单张。                                                         | accepted |
| P1-16F | P1-16E                                                                                                                                                     | 明牌布局修正：东/西家公开出牌贴近各自手牌内侧。                                                         | 组件测试、浏览器人工冒烟。                                        | 明牌时东家出牌在手牌西侧、西家出牌在手牌东侧；关闭明牌恢复默认布局。                                                         | accepted |
| P1-16G | P1-16F                                                                                                                                                     | 明牌可读性修正：非南方明牌的卡面符号缩小并避免纵叠重叠。                                                | 组件测试、浏览器人工冒烟。                                        | 东/西/北家明牌的完整牌和露出牌均不发生点数/花色重叠。                                                                        | accepted |
| P1-16H | P1-16G                                                                                                                                                     | 输出当前牌型规则、基础机器人领出与跟牌策略说明。                                                        | 文档审阅、链接与仓库状态检查。                                    | 文档明确区分冻结规则与当前基础策略，并披露策略边界。                                                                         | accepted |
| P1-16I | P1-16H                                                                                                                                                     | 基础机器人领出策略修正：同型回收牌门槛、小牌优先和多出牌优先。                                          | 固定策略牌例、自动对局、浏览器回归。                              | 低位短牌无同型回收时让位；有回收时优先走小牌；同等牌点优先多张牌型；顺子无回收门槛。                                         | accepted |
| P1-16J | P1-16I                                                                                                                                                     | 人类“提示”与机器人共用领出及接牌策略。                                                                  | 固定牌例、组件测试、自动对局与浏览器回归。                        | 提示只高亮建议牌、不自动提交；不再按候选顺序拆炸弹；提示与机器人在相同局面得到同一动作。                                     | accepted |
| P1-16K | P1-16J                                                                                                                                                     | 最近一圈出牌显示去重：同一座位仅保留最后一次公开动作。                                                  | 组件固定牌例、全量回归、浏览器回归。                              | 东南西北任一座位的旧“不要”或旧出牌被该座位最近动作覆盖；一圈内每座位最多显示一次。                                           | accepted |
| P1-18  | P1-16K                                                                                                                                                     | 连续多局：双方等级、动态级牌、结算、单下/双下进贡、抗贡、还贡、存档恢复与桌面提示。                     | 固定牌例、会话恢复、组件测试、自动对局、构建。                    | 可连续开始下一局；南家手动进贡/还贡；机器人自动交牌；贡后先手与级牌正确；左上记分/贡牌和完成顺序提示可见。                   | accepted |
| P1-19  | P1-18                                                                                                                                                      | 机器人思考时间、结算提示文案与四家机器人称谓统一、动态级牌展示与排序回归。                              | 定时固定牌例、组件测试、排序固定牌例、全量回归、构建。            | 机器人每次动作等待 0.8–1.34 秒；结算文字左对齐且以“南家（你）”表述；东/北/西均标注机器人；动态级牌正确排序并仅标注本局级牌。 | accepted |
| P1-20  | P1-12, P1-14, P1-15A, P1-15B, P1-15C, P1-15D, P1-15E, P1-16A, P1-16B, P1-16C, P1-16D, P1-16E, P1-16F, P1-16G, P1-16H, P1-16I, P1-16J, P1-16K, P1-18, P1-19 | PR Preview、生产部署、回滚演练与发布记录。                                                              | CI 全量 + Preview 人工冒烟。                                      | GitHub `main` 对应 Vercel Production 可玩；`release.md` 含 URL、commit 和回滚目标。                                          | accepted |

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
- P1-15D 自测（2026-07-13）：`App.tsx` 继续只从公开 `action.applied` 事件反向查找 `highestSeat` 对应的 `play`，并将该牌面放到对应座位（北/东/西，或真人南座手牌区）附近；中央仅保留回合与压住提示。清轮后的 `highestSeat` 为空，因此所有座位的当前出牌同步移除。新增“明牌”按钮，默认 `aria-pressed=false`；状态仅由 `App` 的 `showAllHands` 组件状态保存，开启时使用 `sortHumanDisplayCards` 显示东、北、西三家的完整整理手牌，关闭后立即卸载，刷新默认关闭；未修改 `TableSave`、规则事件、快照、`TurnState`、公共事件或 `BotView`。`App.test.tsx` 覆盖东座公开出牌贴近座位、其它座位不误显示、清轮后 `highestSeat` 清空，以及明牌默认隐藏、开关显示 26 张排序手牌并立即隐藏。`npm.cmd run format:check`、`npm.cmd run typecheck`、`npm.cmd run lint`、`npm.cmd run test:run -- --configLoader runner`（16 files / 65 tests）均通过；`vite build --configLoader runner --outDir D:\\MyWorks\\card-game\\temp\\p1-15d-build` 通过并删除临时产物，`git diff --check` 通过。默认 `dist` 目录被 Windows EPERM 文件锁占用，故改用独立临时输出目录完成构建验证；Vite 开发服务以 runner 配置加载后在 `127.0.0.1:5176` 返回 HTTP 200。Playwright CLI 的 npx 临时初始化在本机无输出并超时，未将此记为浏览器冒烟通过，留待主验收补测。

### P1-16A 补丁计划（2026-07-14）

- 先以 ADR 新增 `guandan-v2`：首局由南家领出，行动循环为南→东→北→西；旧 `guandan-v1` 存档明确拒绝恢复，不进行静默迁移。
- 规则与展示分层：方式 A 仅在 UI 排序层优先辨认普通炸弹，其余牌按点数分组；手动显示顺序仍只保存实体牌 ID，不影响规则、事件或机器人视图。
- 桌面改为浅色方形牌桌与四边座位；四家显示余牌圆形计数，少于 10 张变红；明牌复用同一整理器。
- 以 `PatternInterpretation.wildcardAs` 排序公开出牌，并在红桃级牌上显示“配”、普通级牌显示“级”；桌面保留当前轮最近四个公开动作，过牌显示“不要”。
- 验证顺序：固定牌例/组件测试 → 格式化、类型、lint、全量测试 → 本地浏览器人工冒烟 → 文档验收记录与本地提交。
- 自测与验收（2026-07-14）：`ADR-0011` 将首局南家领出及 `guandan-v2` 固化，`guandan-v1` 本地存档明确拒绝恢复；回合环仍以等价的环形顺序实现南→东→北→西。`display-order.test.ts` 覆盖方式 A 炸弹优先、点数分组与红桃级配按代表点数归位；`App.test.tsx` 覆盖南家首局、选牌高亮、明牌同布局、最近动作中的“不要”、手动理牌和旧规则存档拒绝。`npm.cmd run format:check`、`npm.cmd run typecheck`、`npm.cmd run lint`、`npm.cmd run test:run -- --configLoader runner`（16 files / 65 tests）均通过；临时目录构建通过。真实浏览器在本机 Vite 中验收了浅蓝方桌、四边座位、南家首局、余牌圆标、级/配角标、明牌压缩分组布局和操作区。浏览器唯一控制台错误为开发服务器缺少 `favicon.ico` 的 404，非应用逻辑错误。

### P1-16B 补丁计划（2026-07-14）

- 南家区域整体放入牌桌下半部；由上至下固定为过牌/提示/出牌、手牌、说明文字及余牌圆标，不再显示“你的手牌”标题。
- 默认使用纵横叠放，右上角新增“横排”按钮；点击后改为纯横排并显示“竖排”，再次点击恢复纵横叠放。该 UI 开关不进入规则状态、事件流、存档或 BotView。
- 人工理牌后根据新的实体牌 ID 顺序形成连续同点列，保持当前显示模式；纵横叠放中每列最下方为完整牌，上方仅显示牌点和花色。
- 明牌三家复用当前布局模式与相同的分组逻辑；验证组件、完整回归和本地浏览器。
- 自测与验收（2026-07-14）：`groupOrderedDisplayCards` 将人工 ID 顺序中的相邻同点数保留为同一纵列，列 key 采用点数加列序号，避免非相邻同点数在 React 中冲突。`App.test.tsx` 覆盖南家区域在牌桌内、按钮/手牌/说明/数量的顺序、默认纵横叠放、理牌后保持纵列，以及横排/竖排开关同时影响南家和明牌。`npm.cmd run format:check`、`npm.cmd run typecheck`、`npm.cmd run lint`、`npm.cmd run test:run -- --configLoader runner`（16 files / 67 tests）和临时目录生产构建均通过。真实浏览器在本机 Vite 中检查默认纵横叠放（上方仅牌点和花色）及点击“横排”后的纯横排，南家所有指定内容均处于牌桌下半部。开发服务器仅报告缺失 `favicon.ico` 的 404。

### P1-16C 补丁计划（2026-07-14）

- 纵横叠放的完整牌以左上角点数和居中花色显示；上方露出的牌用相同锚点，且取消与下方牌之间的分割线。
- 横排模式不再横向滚动；当手牌宽度超过容器时允许自动换为上下两行。
- 南家控制按钮紧贴手牌上方；南家的公开出牌区域同步下移，保留更大的空白牌桌。
- 以组件断言 CSS class/DOM 排列并做浏览器可视验收，再执行完整回归与本地提交。

### P1-16C 自测与验收（2026-07-14）

- `App.css` 将完整牌的点数/花色固定在左上/居中；紧凑叠牌移除底边和阴影，维持同一锚点且无分割线。横排模式启用自动换行并移除横向滚动；南家操作区与手牌间距压缩，南家公开出牌下移。
- `npm.cmd run format:check`、`npm.cmd run typecheck`、`npm.cmd run lint`、`npm.cmd run test:run -- --configLoader runner`（16 files / 67 tests）及临时目录生产构建均通过。
- 真实浏览器验收默认纵横叠放和 960px 宽度横排：完整牌点数左上、花色居中，纵叠无分割线；横排自动换为两行且无横向滚动；按钮紧贴手牌上方。浏览器唯一控制台错误为开发服务器缺少 `favicon.ico` 的 404，不影响本补丁功能。

### P1-16D 自测与验收（2026-07-14）

- 南家公开出牌锚点上移至操作区上方，出牌下缘与“过牌 / 提示 / 出牌”按钮上缘保持约 `1.5rem` 的安全间距。
- `npm.cmd run format:check`、`npm.cmd run typecheck`、`npm.cmd run lint`、`npm.cmd run test:run -- --configLoader runner` 均通过（16 files / 67 tests）。
- 真实浏览器选择并打出单张后，四家响应正常；南家出牌和操作按钮无重叠。开发服务器唯一控制台错误为缺少 `favicon.ico` 的 404。

### P1-16E 自测与验收（2026-07-14）

- `comparisonKey` 对三带二仅取三张主组的牌点；因此附属对子即使更大也不影响跟牌比较。非残局中，红桃级牌若可按本级牌点压制，不再选用较小的逢人配解释。
- 机器人领出候选加入完整同点数牌组及不拆组的三带二；评分继续惩罚拆对子/三张，避免将完整三张拆为单张。候选和评分均只使用 `BotView` 的自身手牌与合法动作。
- 新增固定牌例覆盖三带二主组比较、级牌不低配、领出完整三张；`npm.cmd run format`、`npm.cmd run typecheck`、`npm.cmd run lint`、`npm.cmd run test:run -- --configLoader runner` 均通过（16 files / 70 tests），临时目录生产构建通过。真实浏览器完成南家单张出牌并由机器人正常响应；唯一控制台错误为开发服务器缺少 `favicon.ico` 的 404。

### P1-16F 自测与验收（2026-07-14）

- 明牌状态为牌桌加入 `show-all-hands` 标记；东家公开动作绝对定位在其手牌西侧，西家公开动作绝对定位在其手牌东侧。关闭明牌立即恢复默认位置。
- `App.test.tsx` 覆盖明牌开关、东/西动作标记；`npm.cmd run format:check`、`npm.cmd run typecheck`、`npm.cmd run lint`、`npm.cmd run test:run -- --configLoader runner` 均通过（16 files / 70 tests），临时目录生产构建通过。
- 真实浏览器中打出单张、机器人响应并开启明牌后，东家 `9♥` 位于东家手牌左侧，西家“不要”位于西家手牌右侧；唯一控制台错误为缺少 `favicon.ico` 的 404。

### P1-16G 自测与验收（2026-07-14）

- 非南方明牌使用更小的完整牌点数/花色；纵叠露出牌进一步缩小，并将花色锚定在右侧、牌点保留在左侧，避免窄卡内文字图案重叠。
- `npm.cmd run format:check`、`npm.cmd run typecheck`、`npm.cmd run lint`、`npm.cmd run test:run -- --configLoader runner` 均通过（16 files / 70 tests），临时目录生产构建通过。
- 真实浏览器开启明牌后检查北、东、西三家：完整牌和纵叠露出牌的牌点与花色均可辨认且无重叠；唯一控制台错误为缺少 `favicon.ico` 的 404。

### P1-16H 自测与验收（2026-07-14）

- 文档现拆分为 `docs/掼蛋规则(被采用)_V1.md` 与 `docs/基础机器人策略说明_V1.md`：前者记录已采用规则，后者说明机器人领出、跟牌、对家保护、残局临界、确定性 tie-break、候选枚举及能力边界。
- 已人工检查文档链接、Markdown 表格、规则与当前 `patterns.ts`、`comparison.ts`、`basic-bot.ts`、`table-controller.ts` 的一致性；`git diff --check` 通过。

### P1-16I 自测与验收（2026-07-14）

- 领出时保持“不拆组”最高优先级；低位单张/对子/三张/三带二分别仅在余牌拥有对应同型回收牌时保留优先级。回收门槛依次为：单张 `A`/级牌/大小王、对子完整 `K`/`A`/级牌对子、三张完整 `J` 及以上三张、三带二中主组三张为 `J` 及以上的完整三带二；四张及以上炸弹不计为回收牌。顺子与更长牌型不受回收门槛限制。
- 领出候选新增自然顺子；固定牌例覆盖：低位单张无回收时领出顺子、低位三带二的同型回收、炸弹不作为对子回收，以及牌桌控制器实际枚举顺子。`basic-bot.test.ts` 与 `table-controller.test.ts` 共 17 项通过。
- `npm.cmd run format`、`npm.cmd run format:check`、`npm.cmd run typecheck`、`npm.cmd run lint`、`npm.cmd run test:run -- --configLoader runner`（16 files / 74 tests，包含批量自动对局）及 `npm.cmd run build` 均通过；`git diff --check` 通过。
- 已尝试本地 Playwright 冒烟，但受当前环境中 `@playwright/cli` 初始化长期无输出所限而中止；本补丁未改 UI，现有 `App.test.tsx` 7 项交互回归已在全量测试中通过。该工具初始化问题不影响构建与策略逻辑验收。

### P1-16J 自测与验收（2026-07-14）

- “提示”改为调用与机器人相同的策略入口；它仍只选中建议牌，实际出牌仍经原有规则入口校验和提交。领出与接牌均使用同一 `BotView`、合法动作集和确定性评分。
- 固定牌例验证：南家持有 `JJJJ` 与单张 `A` 时，提示与机器人均建议整体 `J` 普通炸弹，不会拆为单张；跟牌牌例验证提示与机器人返回同一压制动作。`App.test.tsx` 验证按钮提示和后续出牌流程。
- `npm.cmd run format`、`npm.cmd run format:check`、`npm.cmd run typecheck`、`npm.cmd run lint`、`npm.cmd run test:run -- --configLoader runner`（16 files / 75 tests，含批量自动对局）及 `npm.cmd run build` 均通过；`git diff --check` 通过。
- 沿用 P1-16I 的环境结论：本地 Playwright CLI 初始化长期无输出，无法完成真实浏览器 CLI 冒烟；本补丁的交互路径已由 `App.test.tsx` 覆盖，未影响构建与策略逻辑验收。

### P1-16K 自测与验收（2026-07-14）

- 最近一圈仍以最多四手公开动作作为范围，但在渲染前按座位覆盖：东、南、西、北任一座位只保留该范围内的最后一次动作。因此旧“不要”和旧出牌均不会与该座位更新后的动作并列显示。
- `App.test.tsx` 固定牌例覆盖“西家重复过牌，中间夹有东/北动作”的情形，确认仅保留西家最后一次“不要”；该逻辑使用 `Seat` 作为统一键，四个座位共享同一实现。
- `npm.cmd run format`、`npm.cmd run format:check`、`npm.cmd run typecheck`、`npm.cmd run lint`、`npm.cmd run test:run -- --configLoader runner`（16 files / 76 tests，含批量自动对局）及 `npm.cmd run build` 均通过；`git diff --check` 通过。
- 沿用 P1-16I 的环境结论：本地 Playwright CLI 初始化长期无输出，无法完成真实浏览器 CLI 冒烟；本补丁的 UI 路径已由 `App.test.tsx` 回归覆盖，未影响构建与显示逻辑验收。

### P1-18 自测与验收（2026-07-14）

- 新增纯赛局规则与实体换牌固定牌例：双方独立等级、先出方级牌、双上/头三/头末升级、单下/双下贡牌分配、抗贡、最大贡牌与不大于 10 的还贡校验。
- 连续会话升级为 `guandan-v3` / schema 3，持久化双方等级、局号、先手、级牌、完成顺序、进贡阶段和换牌事件；旧单局存档明确拒绝。南家进贡及还贡均由手动选牌确认，机器人按确定性策略自动交牌。
- `npm.cmd run format:check`、`npm.cmd run typecheck`、`npm.cmd run lint`、`npm.cmd run test:run -- --configLoader runner`（18 files / 89 tests，含批量自动对局）及 `npm.cmd run build` 均通过；`git diff --check` 通过。
- UI 覆盖左上双方等级圆形色块、贡牌/抗贡公开提示、完成顺序后的下一局提示，以及南家手动进贡阶段；本地 Playwright CLI 初始化仍长期无输出，组件回归替代真实浏览器 CLI 冒烟。

### P1-19 自测与验收（2026-07-14）

- 机器人界面动作等待由公开动作数量确定为 0.8、0.98、1.16 或 1.34 秒；仅作用于界面定时器，不写入规则状态、事件流或存档。
- `seatName` 统一显示南家（你）和东/北/西家（机器人）；结算完成顺序以句号分隔并通过左对齐样式展示，贡/还贡提示保持紧随其后。
- 非打 2 局的展示排序明确将 2 降为最小普通牌；`CardFace` 以当前 `levelRank` 判断“级/配”，组件回归验证打 6 时仅 6 标记、2 不标记。
- 在 `frontend/` 执行 `npm.cmd run format`、`npm.cmd run format:check`、`npm.cmd run typecheck`、`npm.cmd run lint`、`npm.cmd run test:run -- --configLoader runner`：全部通过，19 files / 92 tests passed。`npm.cmd run build -- --configLoader runner --outDir D:\MyWorks\card-game\temp\p1-19-build` 通过。

### P1 完结复核（2026-07-15）

- P1-01 至 P1-20 均为 `accepted`；规则、策略、架构、ADR、固定牌例、阶段计划与发布记录已对齐到 `guandan-v4` / 存档 schema 4。
- `npm.cmd run format:check`、`npm.cmd run typecheck`、`npm.cmd run lint`、`npm.cmd run test:run`（19 files / 98 tests，含 1,000 局自动对局）和 `npm.cmd run build` 全部通过。Windows 常规权限无法写入 `node_modules/.vite-temp`，最终 Vitest/Vite 验证在受控权限下完成。
- P1 交接入口见 `proj-info/phases/P1/phase-1-closeout.md`；P2 阶段记录见 `proj-info/phases/P2/`。P2-06 已于 2026-07-16 `accepted`，Production/PWA 与 iPhone Safari 主屏离线启动证据见 `proj-info/phases/P2/release.md` 和 `test-matrix.md`；该门禁不再阻塞 P3。

## P2：移动/PWA 与策略机器人

| ID    | 依赖         | 开发内容                                               | 测试条件                         | 验收标准                                            | 当前状态 |
| ----- | ------------ | ------------------------------------------------------ | -------------------------------- | --------------------------------------------------- | -------- |
| P2-01 | P1-20        | 响应式牌桌、横屏优先布局、安全区与触摸选牌。           | Playwright 手机视口 + 真机抽测。 | Android Chrome、iPhone Safari 可完成核心回合。      | accepted |
| P2-02 | P2-01        | Manifest、Service Worker、离线壳与版本升级提示。       | 离线/升级/缓存清理测试。         | 安装后可离线启动；不以旧缓存运行新规则版本。        | accepted |
| P2-03 | P1-12        | 手牌结构、手数、主攻/助攻、公开大牌统计和置信度模型。  | 固定牌力/过牌样例。              | 推断与确定事实分层；不泄露隐藏牌。                  | accepted |
| P2-04 | P2-03        | 普通难度评分机器人、队友协同、炸弹策略和局面阶段权重。 | 固定策略局 + 固定 seed 对局。    | 机器人选择可解释；不频繁无意义压队友。              | accepted |
| P2-05 | P2-04        | 初级/普通机器人对测、性能预算与回归基线。              | 10,000 局、移动端性能样本。      | 普通难度对初级有稳定指标提升；不超过思考预算。      | accepted |
| P2-06 | P2-02, P2-05 | P2 Preview/Production 发布与 PWA 验收记录。            | 全量 CI、离线 E2E、真机清单。    | Vercel Production 完成 PWA/移动验收，保留回滚版本。 | accepted |

### P2-01 自测（2026-07-15）

- `frontend/src/App.css` 为窄高横屏增加动态视口高度、横屏优先的四边座位缩放与安全区内边距；手牌按钮增加适于触摸的最小命中区和 `touch-action: manipulation`。现有 P1 的四边牌桌、横/竖排、手动理牌、选择高亮和统一规则提交路径均原样复用，未回退既有能力。
- `frontend/src/App.tsx` 在触摸结束时直接切换实体牌 ID 的选中状态；桌面 click、键盘理牌和拖拽仅保留为已有增强路径，规则、存档、事件流与 BotView 未改动。`frontend/src/App.test.tsx` 新增触摸选中/取消选中回归。
- 在 `frontend/` 已通过：`npm.cmd run format:check`、`npm.cmd run typecheck`、`npm.cmd run lint`、`npm.cmd run test:run -- --configLoader runner`（19 files / 99 tests）以及 `npm.cmd run build -- --configLoader runner --outDir D:\MyWorks\card-game\temp\p2-01-build`。`git diff --check` 通过。
- 未覆盖：本机 Playwright CLI 的 `npx` 初始化历史上长期无输出，未能得到手机视口浏览器证据；当前无 Android Chrome 或 iPhone Safari 真机可供抽测。因此本任务仅提交 `ready_for_acceptance`，不得据此宣称真机验收已完成。主验收应在 Android Chrome 和 iPhone Safari 横屏下完成一轮选牌、提示、出牌与机器人响应，并检查刘海/底部手势区无遮挡。
- 真机失败证据（2026-07-15）：用户提供的 `temp/iphone横屏.jpg` 与 `temp/iphone竖屏.jpg` 显示，原移动样式保留 `700px`/`780px` 固定桌高和绝对定位，导致横屏座位、公开牌、记分与中央信息重叠，竖屏操作区、手牌及说明越出可用视口。该证据否定了先前的真机可用性假设。
- 修复（2026-07-15）：新增 `responsive-table` 布局边界；窄竖屏与矮横屏均改为 CSS Grid 自然流，依次安放记分、四座、桌面信息、南家公开牌和南家操作/手牌，桌高改由 `100dvh` 与内容共同决定，手牌和操作按钮可换行，安全区内边距继续保留。组件回归新增该布局边界断言；`npm.cmd run format:check`、`npm.cmd run typecheck`、`npm.cmd run lint`、`npm.cmd run test:run -- --configLoader runner`（19 files / 100 tests）及 `npm.cmd run build -- --configLoader runner --outDir D:\MyWorks\card-game\temp\p2-01-mobile-fix-build` 均通过。修复后仍需用户在同一 iPhone 的横屏与竖屏实际复测，确认无重叠和横向裁切后才能进入 `accepted`。
- 第二轮真机回归（2026-07-15）：用户提供的新 iPhone 横屏截图显示同点牌的紧凑牌面外层仍占用完整按钮高度，列内出现大空白；北家 `card-count` 又被移动 Grid 的默认拉伸占满一行。修复为 `compact-card` 增加与紧凑牌面一致的短最小高度，并为所有座位计数增加 `seat-card-count` 与 `justify-self: center`/`width: fit-content`。`App.test.tsx` 新增纵叠牌和座位计数布局边界断言；`npm.cmd run format:check`、`npm.cmd run typecheck`、`npm.cmd run lint`、`npm.cmd run test:run -- --configLoader runner`（19 files / 101 tests）、生产构建 `D:\MyWorks\card-game\temp\p2-01-second-mobile-fix-build` 及 `git diff --check` 均通过；仍需真机横竖屏复测本轮两项。
- 第三轮真机回归（2026-07-15）：用户提供的 iPhone 横竖屏截图显示纵叠上方 `compact` 牌仍硬编码为桌面 `3rem` 宽度，不能与移动端底牌对齐；移动缩放后的牌面继续使用桌面点数/花色字号，公开牌与手牌均出现文字重叠。`CardFace` 新增 `size-token-card` 尺寸边界，`App.css` 用继承的自定义属性统一普通牌与紧凑牌的宽高，并按竖屏、矮横屏实际卡宽同步缩放点数、花色、级/配徽章和逢人配文本。`App.test.tsx` 先新增普通/紧凑牌共享尺寸边界的失败回归，再验证通过；`npm.cmd run format:check`、`npm.cmd run typecheck`、`npm.cmd run lint`、`npm.cmd run test:run -- --configLoader runner`（19 files / 102 tests）、生产构建 `D:\MyWorks\card-game\temp\p2-01-card-scale-build` 和 `git diff --check` 均通过。仍需同一 iPhone 横竖屏复测：同组紧凑牌宽度必须等于底牌，点数/花色/徽章不得重叠，公开出牌与手牌均应可辨认。
  - 第四轮真机回归（2026-07-15）：用户要求纵叠紧凑牌彼此及与底牌之间无可见缝隙。南家纵叠组新增 `joined-card-stack`，以 1px 负边距覆盖相邻牌边框；紧凑牌按钮改为块级、零最小高度和零行高，消除按钮基线或最小高度残留空白。`App.test.tsx` 新增无缝连接边界断言，先失败后通过；`npm.cmd run format:check`、`npm.cmd run typecheck`、`npm.cmd run lint`、`npm.cmd run test:run -- --configLoader runner`（19 files / 103 tests）、`npm.cmd run build -- --configLoader runner --outDir D:\MyWorks\card-game\temp\p2-01-stack-seam-build` 与 `git diff --check` 均通过。仍需 iPhone 横竖屏复测，确认紧凑牌之间及紧凑牌与底牌之间没有空白或双边框缝隙。
  - 主验收（2026-07-15）：用户完成多轮 iPhone Safari 横竖屏实机反馈，确认当前视觉修订“先这样”，并明确要求继续后续 P2 子任务；主 agent 已复跑格式、typecheck、lint、103 项 Vitest、生产构建与 diff 检查，全部通过，故标记为 `accepted`。Android Chrome 真机未抽测，作为 P2 已知风险保留至 P2-06 的移动真机清单，不回退本次用户验收。

### P2-02 自测（2026-07-15）

- `ADR-0013-pwa-versioned-static-shell.md` 先固定缓存边界：Cache Storage 只保存当前构建的入口 HTML、带哈希 JS/CSS、manifest 和图标；缓存名同时含 `guandan-v4` 与资源清单指纹；禁止 Service Worker 读取、写入或缓存 IndexedDB、事件流、快照和任何牌局数据。
- `frontend/vite.config.ts` 在构建阶段从实际 bundle 生成 `service-worker.js` 静态清单；`index.html` 引用 manifest，`public/` 提供 manifest 与 SVG 图标。应用启动时注册 Service Worker；若已有控制器且新 worker 在等待，才显示“更新”按钮，确认后发送 `SKIP_WAITING`，激活时清理本应用此前版本缓存并重载。无新增依赖，规则、存档、BotView 和牌局状态未改动。
- 先新增 `src/pwa/service-worker.test.ts` 并确认因实现模块不存在而失败；实现后 3 项回归覆盖：预缓存仅含当前版本静态资源和离线导航回退、旧缓存清理、等待中的升级必须经用户确认才激活，以及无 Service Worker API 时保持 SSR-safe。全量 `npm.cmd run test:run -- --configLoader runner` 通过（20 files / 106 tests）；`npm.cmd run format:check`、`npm.cmd run lint` 与 `git diff --check` 通过。
- 构建证据：`npx.cmd vite build --configLoader runner --outDir D:\MyWorks\card-game\temp\p2-02-build` 成功，输出 `service-worker.js`、`manifest.webmanifest`、图标和带哈希的 CSS/JS；生成的缓存名为 `card-game-shell:guandan-v4:assets-9504273f`，静态清单只包含上述离线壳资源。浏览器真实离线安装、更新按钮和 Cache Storage 清理仍需主验收在 Chromium DevTools 或真机按离线/更新清单抽测。
- 标准 npm 门禁修复（2026-07-15）：主验收稳定复现 `structuredClone` 在 `event-store.ts` 的类型缺失，不能作为环境例外。删除依赖隐式 DOM 全局合并的调用，新增 `platform/structured-clone.ts` 显式运行时边界：通过 `Reflect.get(globalThis, "structuredClone")` 检查标准 API 是否存在，并在唯一边界以泛型签名返回原类型；不提供 polyfill，也不放宽事件流类型。`runtime-globals.test.ts` 覆盖值与嵌套对象均被真实克隆。修复后标准 `npm.cmd run typecheck`、`npm.cmd run build -- --configLoader runner --outDir D:\MyWorks\card-game\temp\p2-02-build`、`npm.cmd run test:run -- --configLoader runner`（21 files / 107 tests）、`npm.cmd run format:check`、`npm.cmd run lint` 与 `git diff --check` 均通过。
- 更新检测补强与主验收（2026-07-15）：`registerPwaServiceWorker` 在 `updatefound` 后监听 installing worker 的 `statechange`；只有其成为 `installed`、且已有 controller 与 waiting worker 时才显示更新入口，用户点击后才发送 `SKIP_WAITING`。新增回归覆盖该真实时序。主验收通过 `npm.cmd run test:run -- --configLoader runner`（24 files / 115 tests）、`npm.cmd run typecheck`、`npm.cmd run format:check`、`npm.cmd run lint`、生产构建和 `git diff --check`。Chrome 在 `http://127.0.0.1:4173/` 生产离线壳中实际验证：更新提示出现、点击更新后新 worker 接管并重载；停止静态服务器后仍可离线重载和恢复牌桌。构建清单、缓存版本与旧缓存清理边界另由定向单测和生成的 `service-worker.js` 核对，均未包含 IndexedDB、事件流或快照。

### P2-03 自测（2026-07-15）

- `ADR-0014` 固定策略观察边界：仅消费 BotView；己方手牌结构、各席余牌数为确定事实；公开高位出牌只依据公开动作的比较键与张数，不反查牌库、对手手牌或 seed。主攻/助攻仅为可解释推断，不写规则状态或存档。
  - 新增纯 `strategy-analysis.ts`：输出按点数组合、公开高位出牌张数、余牌事实，以及主攻/助攻、置信度和理由。固定样例先因模块不存在失败，后通过，覆盖对子结构、公开高位动作统计、攻击角色和同手数低置信度；`npm.cmd run typecheck` 通过。主验收应复跑全量门禁并确认输出不含 `opponentHands`。
- 主验收（2026-07-15）：已复核 ADR-0014 的 BotView 信息边界与固定样例，并通过 `npm.cmd run format:check`、`npm.cmd run typecheck`、`npm.cmd run lint`、`npm.cmd run test:run -- --configLoader runner`（22 files / 109 tests）、`npm.cmd run build -- --configLoader runner --outDir D:\MyWorks\card-game\temp\p2-03-main-acceptance-build` 和 `git diff --check`；标记为 `accepted`。

### P2-05 自测（2026-07-15）

- 初级与普通机器人均只接收 `BotView`；自动对局按座位注入难度，仍经由合法动作生成、`validateAction` 和 `applyAction`。普通机器人新增对手领出时的压制权重，保留已有的队友牌权、残局拦截、炸弹保留和阶段理由，固定样例覆盖该回归。
- `benchmarkBots` 以四个独立的 2,500 局固定 seed 分片运行，避免长测试阻塞常规 Vitest 工作进程；`test:run` 明确排除该长基准，`benchmark:p2` 显式执行全部四片。每片均断言完成 2,500 局、普通队头游率大于 50%、平均决策小于 10ms。
- 主验收（2026-07-15）：`npm.cmd run format:check`、`npm.cmd run typecheck`、`npm.cmd run lint`、`npm.cmd run test:run -- --configLoader runner`（24 files / 114 tests）、`npm.cmd run build -- --configLoader runner --outDir D:\MyWorks\card-game\temp\p2-05-final-build` 和 `git diff --check` 通过。主机实跑 `npm.cmd run benchmark:p2`（10,000 局）通过：完成率 100%，普通队头游率 73.17%，平均 190.98 动作/局，平均决策 0.059ms/动作；四片最大单局耗时 79.04ms。标记为 `accepted`。

### P2-06 自测（2026-07-15）

- Preview `https://card-game-mf2xxwu9v-wentop.vercel.app` 已由 Vercel 构建为 Ready；Chrome 实际打开 HTTPS 页面并进入牌桌。390×844 竖屏与 844×390 横屏视口均验证 `scrollWidth === clientWidth`。验收中发现公开出牌 `public-action` 在窄屏不换行会造成横向溢出，已在移动断点增加换行与最小宽度边界；修复后本地格式、typecheck、lint、24 files / 115 tests、生产构建和 diff 检查通过。
- Production 已提升同一修复 Preview：`https://card-game-wentop.vercel.app`，部署 `dpl_GqnbABu5EoMVqacoQjgEyJwMo1k5` 状态 Ready；Chrome 访问正式入口可进入牌桌并显示 PWA 更新提示。上一 Production `https://card-game-ez2wq9nml-wentop.vercel.app` 可作为回滚目标。
- 真机验收（2026-07-16）：用户确认已在 iPhone Safari 以正式 HTTPS URL 完成“添加到主屏幕 → 关闭 Safari → 飞行模式离线启动 → 恢复网络并确认更新提示”清单；结合 Production `dpl_6i79U85p4bAstRwUowj3guxaETAf` 的 Ready 状态、正式入口/Manifest/Service Worker HTTP 200 及 `guandan-v5` 离线壳复核，P2-06 标记为 `accepted`。
- 回归修复（2026-07-15）：用户截图确认横排手牌的点击区域宽于牌面，现使 `.human-hand.flat .hand-card` 在桌面和移动断点均与实际牌面等宽。另发现正式牌桌错误调用初级机器人，导致跟牌时把四张炸弹误判为比三带二更低代价、拆小王对子和自然顺子；现改为接入普通策略机器人。新增三个固定牌例：同型三带二优先于无必要炸弹、单 A 时保留小王对子而走大王、面对小单张优先用小王而不拆 10-J-Q-K-A。主验收串行运行 `format:check`、`typecheck`、`lint`、`test:run -- --configLoader runner --maxWorkers=1 --minWorkers=1`（24 files / 118 tests）、生产构建 `D:\MyWorks\card-game\temp\strategy-ui-fix-build` 与 `git diff --check` 均通过。此修复尚待随下一次 Production 部署发布。
- 规则与布局回归（2026-07-15）：修复级牌连续牌比较错误并通过 ADR-0015 将规则版本升级为 `guandan-v5`；连续牌型中级牌按普通点数，`A2345` 的 A 为最小端。固定牌例覆盖打 5 时 `334455` 不可压 `778899`、`444555` 与 `A2345` 的普通比较键。南家“不要”改为与公开牌相同高度的动作容器内底部对齐，消除其与出牌牌面下缘不齐造成的空档。主验收通过 `format:check`、`typecheck`、`lint`、串行 `test:run`（24 files / 119 tests）、生产构建与 `git diff --check`；提交 `d8d4e2b` 已推送 GitHub，并部署到 Production `dpl_6i79U85p4bAstRwUowj3guxaETAf`，正式 URL 匿名 HTTP 200 且公开 bundle 含 `guandan-v5`。

### P2.7 本地策略稳定化（2026-07-22）

这不是新的 P2 子任务，也不改变 P3-01 的依赖状态。产品唯一机器人已收敛为 normal-vNext；P2.7 固化了下家尾局阻断、合法动作兜底、自然中小结构争牌、控制资源保护和明牌后出牌覆盖先出牌的显示层级。

验证证据：`typecheck`、`lint`、normal-vNext 固定牌例 41 项、策略指标 1 项、table-controller 11 项和 App 19 项均通过。策略仅消费 BotView 和规则层完整 legalActions；规则引擎、normal-v1、P2.5 expert 与默认 profile 均未改变。P2.7 已于 2026-07-23 由 Vercel `wentop/card-game` 远端构建并部署 Production，正式入口 `https://card-game-wentop.vercel.app/` 已匿名 HTTPS 复核 HTTP 200，用户已完成试玩并确认验收；本版收口，发布记录见 `P2/release.md`。

## P2.5：整手规划驱动的专家策略与评分系统

> **已撤销（2026-07-22）。** P2.5-01 至 P2.5-16 的实现与 expert-24 Preview
> 已通过可逆的 Git revert 从产品分支移除；当前唯一产品机器人为 normal-vNext。
> 下表保留为历史计划，不得据此启动任务。恢复 P2.5 必须先新增 ADR、重新评审并
> 通过人工 Preview 验收。详见 `proj-info/phases/P2.5/tasks.md` 与 ADR-0024。

> 下表是撤销时的历史任务清单，所有条目均为 `revoked`，不构成实施授权。

| 任务    | 依赖                                                 | 工作内容                             | 核心验证                                                            | 状态    |
| ------- | ---------------------------------------------------- | ------------------------------------ | ------------------------------------------------------------------- | ------- |
| P2.5-01 | P2-06                                                | 决策流、候选生成与模拟器审计基线。   | 七类试玩失误、候选缺口、空公开事件和性能基线。                      | revoked |
| P2.5-02 | P2.5-01                                              | 架构/数据契约/性能 ADR。             | analyzer、hand plan、缓存、9 项指标、profile、确定性与分档预算。    | revoked |
| P2.5-03 | P2.5-01                                              | 50 个专家牌例目录与 fixture schema。 | 推荐/拒绝/备选、结构/动作后/资源/争夺/路线断言。                    | revoked |
| P2.5-04 | P2.5-02, P2.5-03                                     | HandStructureAnalyzer。              | 三种来源、四王炸、天然/逢人配组合、散牌和控制/回收牌。              | revoked |
| P2.5-05 | P2.5-04                                              | HandPlanGenerator。                  | 确定性 Top-N 四类整手方案、预计手数、roleFit、finishability、风险。 | revoked |
| P2.5-06 | P2.5-02, P2.5-03                                     | SituationAnalyzer。                  | 公开事件、威胁、队友状态、攻助角色和置信度。                        | revoked |
| P2.5-07 | P2.5-04, P2.5-05                                     | 候选生成 2.0。                       | 三连对、钢板、合理逢人配、同花顺、四王炸和 hand-plan 候选。         | revoked |
| P2.5-08 | P2.5-04, P2.5-05, P2.5-07                            | PostActionHandEvaluator。            | 每候选动作后重新组牌并比较余牌质量。                                | revoked |
| P2.5-09 | P2.5-04, P2.5-06, P2.5-08                            | ControlResourceEvaluator。           | 王/级牌/逢人配/A/高对子/炸弹预算和例外。                            | revoked |
| P2.5-10 | P2.5-05, P2.5-06, P2.5-07, P2.5-08, P2.5-09          | FollowUpPlanner。                    | 至少前看自己的下一手和连续出完路线。                                | revoked |
| P2.5-11 | P2.5-06, P2.5-08, P2.5-09, P2.5-10                   | ContestEvaluator。                   | 删除机械争夺，综合威胁、收益、成本和后续路线。                      | revoked |
| P2.5-12 | P2.5-08, P2.5-09, P2.5-10, P2.5-11                   | ActionFeatureExtractor。             | 统一引用动作后、控制、争夺和路线特征。                              | revoked |
| P2.5-13 | P2.5-02, P2.5-03, P2.5-06, P2.5-08, P2.5-09, P2.5-11 | ExpertStrategyKnowledgeBase v1。     | 30–40 条且覆盖九类错误；evidence/maturity、测试、牌例、开关和解释。 | revoked |
| P2.5-14 | P2.5-12, P2.5-13                                     | ActionScorer/ActionSelector。        | 整手规划驱动评分、稳定 tie-break、无机械极值。                      | revoked |
| P2.5-15 | P2.5-14                                              | DecisionExplanation/Profile。        | expert/normal/experimental；机器人/提示共用入口；证据解释不入存档。 | revoked |
| P2.5-16 | P2.5-07, P2.5-14, P2.5-15                            | 模拟器、九项专项指标与分档性能。     | 完整候选、累计公开事件、10,000 局、头游/双上与平均/P95。            | revoked |
| P2.5-17 | P2.5-03, P2.5-16                                     | 校准、全量验收与发布。               | 50 例及九类错误通过后，机器人/提示默认 expert；normal 对照及回滚。  | revoked |

P2.5A/B/C 和 Bot-AI 2.x 的原始规划仅作历史追溯。未来机器人改进应以
normal-vNext 的独立任务和 ADR 重新规划，不占用 P3 多人服务端阶段编号。

## P3：多人联网掼蛋

### P3 产品与架构边界

- 一间房支持 1–4 名真人。创建者先占一个座位；开始时其余空座全部由唯一产品机器人 normal-vNext 控制。真人只可在房间等待/准备阶段入座或换座；开局后的断线、超时和回归只按 P3-08 的动作边界托管规则处理。
- 真人以匿名身份进入：首次进入可从预设名称“曹操、刘备、孙权、周瑜、诸葛亮、关羽、张飞、赵云、貂蝉、小乔、甄宓”中选择，或提交经输入规则校验的自定义名称。名称是显示资料，不是授权凭证；每个房间内必须唯一。未被真人占据的座位没有名称选择流程，始终由 normal-vNext 机器人控制。
- 服务器是唯一权威：生成并保管安全随机种子、验证和执行动作、驱动机器人、分配事件序号并持久化完整状态。客户端只能发送命令和接收自己的手牌/公共投影，不能接收其他手牌、seed 或机器人隐藏评估。
- 所有后台可执行程序、运行时配置、数据访问适配器、服务端测试和部署清单都必须位于根目录 `backend/`；不得把服务端实现放入 `frontend/` 或根目录。共享纯 TypeScript 规则核心的最终源位置和构建边界由 P3-01 ADR 冻结，但 `backend/` 不得导入 React、DOM、IndexedDB、PWA 或任何 UI 模块。
- 房间访问方式、房主权限、邀请码/可见性、座位保留期、超时、TTL、数据保留、恢复目标、协议兼容策略和受控回放权限均为 P3-01 必须关闭的产品/运维决策；不能在实现中临时推断。
- 生产回放使用服务端受控的 room/event/受保护 seed 记录，仅用于恢复、审计和测试；任何客户端、浏览器日志、公共事件或响应均不得包含 seed。

| ID    | 依赖                       | 开发内容                                                                                                                                                                           | 测试条件                                                                                                           | 验收标准                                                                                                                                                                                     | 当前状态    |
| ----- | -------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------- |
| P3-01 | P2-06                      | 多人架构与产品 ADR、POC：比较实时传输、常驻后台、持久化和部署选项；冻结身份/房间访问、令牌、CSPRNG、协议版本、数据保留、恢复/退出、预设/自定义显示名称和 1–4 真人+机器人席位语义。 | 4 客户端连接、断连、冷启动恢复、成本/连接上限/时延测量。                                                           | ADR 分别记录第三方服务、多人协议、随机数和持久化的不可逆选择；名称池、自定义名称校验、房内唯一性及名称不作为授权凭证均有固定测试；包含 Hobby 合规、数据归属、容量、RPO/RTO、回滚与迁出方案。 | accepted    |
| P3-02 | P3-01                      | 将浏览器与 Node 共同消费的纯 TypeScript 核心物理迁移到 `packages/guandan-core/`，并建立 root workspace/package export 边界；保留 platform 不导入游戏专属类型。                     | 同一固定 seed、初始状态和动作流在浏览器测试运行时与 `backend/` Node 测试运行时得到相同结果；静态 import 边界测试。 | `packages/guandan-core/` 是规则、牌局会话和 BotView 的唯一源码；frontend/backend 均以包名导入，后端不导入 UI/浏览器 API；规则版本和事件/快照兼容契约已测试。                                 | accepted    |
| P3-03 | P3-02                      | 在 `backend/` 创建服务端工程：健康检查、配置 schema、最小权限运行、匿名身份、轮换重连令牌，以及基础鉴权/授权、输入 schema、速率限制和日志脱敏。                                    | 配置校验、令牌失效/轮换、未授权座位访问、模糊输入和限流测试。                                                      | 无密钥入库；所有公开入口在房间功能前已执行身份、权限和输入边界；健康探测可用且日志不含敏感牌面。                                                                                             | accepted    |
| P3-04 | P3-03, P1-09               | 服务端权威牌局与原子事件存储：CSPRNG 种子、个人视图投影、命令幂等键、连续事件序号、快照、TTL、恢复和受控回放。                                                                     | 恶意/重复命令、并发提交、服务重启、损坏快照、过期房间和投影快照测试。                                              | 每个成功 ACK 均对应可恢复的幂等命令和连续持久化事件；客户端不能决定洗牌/出牌/机器人；响应、日志和公共事件均不泄露 seed 或他人手牌。                                                          | accepted    |
| P3-05 | P3-04                      | 房间生命周期：创建、受控加入、座位、准备、开始、满房和 1–4 真人的空座 normal-vNext 机器人填充。                                                                                    | 多房并发、重复加入、满房、换座、开始时 1/2/3/4 真人矩阵测试。                                                      | 房间状态转移可审计；开局时所有四席均有唯一控制者，空座均由 normal-vNext 托管，真人不可越权控制其他座位。                                                                                     | accepted    |
| P3-06 | P3-04, P3-05               | 实时事件协议：版本协商、顺序号、ACK、缺口恢复、重放和客户端投影同步。                                                                                                              | 乱序、重复、延迟、丢包、服务重启与重连模拟。                                                                       | 客户端最终与服务端同一事件序列一致且不重复执行；协议不兼容时明确拒绝或升级，不静默解释旧消息。                                                                                               | accepted    |
| P3-07 | P3-05, P3-06               | 多人前端：大厅、创建/加入房间、座位/准备、等待、个人视图、连接状态与错误恢复；隔离本地单机 IndexedDB 存档和联机房间状态。                                                          | 1–4 真人 UI 流程、空座机器人展示、刷新/重连、拒绝加入和本地存档共存组件/E2E 测试。                                 | 前端不保存权威完整状态或其他手牌；联机操作只提交命令；单机模式保持可用且不会写入或恢复联机权威状态。                                                                                         | not_started |
| P3-08 | P3-05, P3-06               | 超时、断线等待、机器人托管与安全交接；重连按已冻结的座位保留和房主规则恢复。                                                                                                       | 刷新、断网、超时、回归和并发接管测试。                                                                             | 仅在动作边界交接控制权；重连真人恢复原座位和个人视图；机器人与真人均经同一服务端命令校验路径。                                                                                               | not_started |
| P3-09 | P3-04, P3-06, P3-07        | 安全强化：四视角信息泄露回归、会话固定/重放防护、权限矩阵、压力与滥用防护。                                                                                                        | 四个座位抓包、令牌重放、模糊输入、压力样本和日志扫描。                                                             | 0 他人手牌/seed/隐藏评估泄露；异常请求被拒绝、限流并产生脱敏安全日志。                                                                                                                       | not_started |
| P3-10 | P3-04                      | 可观测性与运维：结构化日志、指标、告警阈值、备份和恢复演练。                                                                                                                       | 故障注入、备份恢复、容量样本和 RPO/RTO 演练。                                                                      | 可定位房间/事件而不记录敏感牌面；恢复目标有实测证据，备份、保留和删除均可审计。                                                                                                              | not_started |
| P3-11 | P3-07, P3-08, P3-09, P3-10 | 端到端多人回归与网络混沌测试。                                                                                                                                                     | 1–4 真人、机器人补位、断线、重连、超时、重启、过期和协议升级全矩阵。                                               | 所有 P3 场景通过；问题可由服务端受控 room/event/seed 记录复现，不把 seed 暴露给客户端。                                                                                                      | not_started |
| P3-12 | P3-11                      | 前端 Vercel 与 `backend/` 后端部署、Preview/Production 验收、回滚和发布记录。                                                                                                      | 生产模拟房、健康检查、四视角抽测、日志扫描和回滚演练。                                                             | 前端在 Vercel Hobby；后端选型合规；Preview 与 Production 均验证 1–4 真人/机器人空座路径，`release.md` 含版本、URL、回滚目标和证据。                                                          | not_started |
