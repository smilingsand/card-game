# P3 测试矩阵

## P3-07 测试矩阵（accepted）

| 验收项                                          | 证据                                                                                                 | 当前结果                                                                                         |
| ----------------------------------------------- | ---------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------ |
| 多人大厅、预设/自定义名称、房间与机器人空座展示 | `cd frontend; npm.cmd run test:run -- --configLoader runner src/multiplayer/MultiplayerApp.test.tsx` | 组件测试 4/4 通过：创建请求只提交名称和逻辑座位；支持自定义名称；四席视觉投影保持本人在 bottom；出牌意图不携带可信 actor/seat。 |
| 前端静态检查与单机隔离                          | `cd frontend; npm.cmd run typecheck; npm.cmd run lint; npm.cmd run build`                            | 通过；单机 IndexedDB 仅在 `SoloApp` 子树挂载，多人模块只保存个人投影、房间投影和连接序号。       |
| 本地 Vite → Wrangler 冒烟                       | 运行本地 Worker 与 Vite 后访问 `/`、`/v1/session`                                                    | 通过：Vite 主页 200，`/v1/session` 经代理返回 201 与重连 cookie；未登录、未部署或创建云资源。    |

## P3-06 测试矩阵（accepted）

| 验收项                                   | 证据                                                                                | 当前结果                                                                                      |
| ---------------------------------------- | ----------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------- |
| WebSocket 协商、ACK、乱序/重复与缺口恢复 | `cd backend; npm.cmd run test:p3-06`                                                | 本地 Miniflare：`p3-ws-v1` 协商、命令 ACK 幂等、延迟旧序号冲突、丢包后的 `resync` 重放均通过  |
| 重启恢复、未授权和协议拒绝               | 同上                                                                                | SQLite DO 冷启动后从序号 0 重放；陌生会话为 403；不兼容版本返回 `protocol.unsupported` 后关闭 |
| 后端回归与类型                           | `cd backend; npm.cmd run typecheck; npm.cmd run test:p3-03; npm.cmd run test:p3-05` | 类型检查通过；P3-03/04 共 14 项、P3-05 共 3 项回归通过                                        |

ADR-0029 已冻结真人 `subject → roomId → logical seat` 控制链；Authority 忽略客户端伪造 actor，并按绑定座位与权威回合执行动作。四个视角的显示旋转只发生在个人投影/UI 层，不改变逻辑行动顺序。

## P3-05 测试矩阵（accepted）

| 验收项                                   | 证据                                 | 当前结果            |
| ---------------------------------------- | ------------------------------------ | ------------------- |
| 房间创建、邀请制受控加入与名字唯一性     | `cd backend; npm.cmd run test:p3-05` | 本地 Miniflare 通过 |
| 1–4 真人、满房、准备/开始与 bot 空座     | 同上                                 | 本地 Miniflare 通过 |
| 座位请求须由房主批准，且不泄露 seed/手牌 | 同上                                 | 本地 Miniflare 通过 |

| 验收项               | 证据                                                                      | 结果                                    |
| -------------------- | ------------------------------------------------------------------------- | --------------------------------------- |
| P3-02 浏览器固定回放 | `cd frontend; npm.cmd run test:run -- core-cross-runtime.browser.test.ts` | 固定 seed、初始状态和动作流的浏览器回放 |
| P3-02 Node 固定回放  | `cd frontend; npm.cmd run test:core --workspace=card-game-backend`        | `backend/` 仅以包名消费同一核心         |

P3-02 主验收（2026-07-23）：`node frontend/node_modules/typescript/bin/tsc -p packages/guandan-core/tsconfig.json --noEmit --pretty false`、前端两份 tsconfig、ESLint、Prettier、Vite production build 均通过；浏览器固定回放与 App 测试共 20 项通过；Node 后端固定回放 1 项通过；核心 table-session 与 BotView 牌例 14 项通过。共享包只使用 ES2022 类型，不依赖 DOM、React、Vite、Cloudflare 或 Node 专属 API。

## P3-03 测试矩阵（accepted）

| 验收项                               | 证据                                                                                                                          | 当前结果                                                                                          |
| ------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------- |
| Worker 健康检查与 SQLite DO 本地链路 | `cd backend; npm.cmd run test:p3-03`                                                                                          | Miniflare SQLite DO：`/health`、匿名会话、令牌轮换并使旧令牌失效、模糊输入拒绝、限流，共 6 项通过 |
| 配置、鉴权与日志脱敏                 | `cd backend; npm.cmd run typecheck`；同上安全单测                                                                             | 配置 schema、跨身份访问拒绝、Cookie 安全属性与 token/seed/手牌字段脱敏均通过                      |
| 既有共享核心边界与固定回放           | `cd backend; npm.cmd run test:core`                                                                                           | 2 项通过；后端仍只通过 `@card-game/guandan-core` 消费共享核心                                     |
| 格式、CLI 与差异检查                 | `cd backend; node ../frontend/node_modules/prettier/bin/prettier.cjs --check .`；`npx wrangler --version`；`git diff --check` | Prettier 通过；Wrangler `4.113.0`；差异检查通过                                                   |

本任务未执行 `wrangler login`、部署或任何云资源操作；`wrangler.jsonc` 仅定义本地 Worker/SQLite Durable Object 配置。Wrangler、Miniflare 与官方 Workers 类型为锁定的本地开发依赖；黑盒测试以 `new_sqlite_classes` 对应的 SQLite DO 配置运行。P3-12 前仍不得进行公网部署。

# P3-04 测试矩阵（accepted）

| 验收项                       | 证据                                                                                                    | 当前结果                                                                                                                                    |
| ---------------------------- | ------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------- |
| 256 位 seed 与旧 number 兼容 | `cd frontend; npm.cmd run test:core -- --run ../packages/guandan-core/src/platform/secure-seed.test.ts` | 同一 64 位十六进制 seed 的洗牌、事件流、序列化与恢复一致；尾部 word 会影响洗牌；旧 number seed 与 `Math.random()` 禁用回归受测。            |
| Worker/Node 权威回归         | `cd backend; npm.cmd run typecheck; npm.cmd run test:p3-03`                                             | 本地 Miniflare SQLite DO：个人投影、动作 ACK 幂等、并发串行化、TTL、未授权回放、冷启动恢复均通过。                                          |
| seed 生命周期与快照完整性    | 同上 P3-04 用例                                                                                         | 两次新比赛具有不同 `gameId` 和受控内部 seed 指纹；冷启动保留同局 seed；重新开赛清除旧命令/事件/快照；篡改快照后只返回安全错误且不泄露状态。 |

说明：完整 `npm.cmd run test:core` 在当前单次 64 秒执行上限内未完成且未输出失败；P3-04 相关的 `secure-seed.test.ts`（4 项）与 `table-session.test.ts`（12 项，含显式 secure 下一局）已单独通过。

# P3-01 测试矩阵

| 验收项                         | 证据                                            | 结果                                                                                             |
| ------------------------------ | ----------------------------------------------- | ------------------------------------------------------------------------------------------------ |
| 名称池、规范化、房内唯一       | `node --test backend/poc/name-policy.test.mjs`  | 2026-07-23：3/3 通过                                                                             |
| 四客户端连接、断连、冷启动恢复 | `cd backend/poc; npm.cmd test`                  | 2026-07-23：Miniflare 四客户端 POC 通过；见 `backend/poc/README.md`                              |
| 成本、连接上限、时延测量       | `cd backend/poc; npm.cmd run measure`；ADR-0025 | 2026-07-23：本地四席/重连批次已测；当前与早期公网 MVP 均固定 Workers Free，线上配额在 P3-12 实测 |
| 本地与公网授权边界             | ADR-0025；P3 README                             | 本地为 Vite → Wrangler → SQLite DO；P3-12 前禁止部署，届时等待用户完成 Free 账号与本机登录授权   |
| 协议版本、CSPRNG、回放权限     | ADR-0026、ADR-0028                              | 设计已冻结；P3-04/P3-06 实现回归                                                                 |

本机 POC 不创建云资源。禁止提交密码、API Key、token、本地登录凭据或 `.env`。Cloudflare 仅承载后端，不替代 Vercel 前端/PWA。
