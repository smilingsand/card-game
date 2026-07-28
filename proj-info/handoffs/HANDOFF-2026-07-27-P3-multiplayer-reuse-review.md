# P3 多人牌桌复用审查交接（2026-07-27）

## 一句话状态

P3-08、P3-09、P3-10 已有本地提交；P3-07/P3-11 的多人前端和后续修正仍在**未提交的脏工作区**。自动化 Miniflare 测试一度通过，但用户在真实浏览器中仍观察到真人出牌被后续机器人动作覆盖/误显示、首个机器人响应长时间延迟等基本交互故障。因此 P3-11 **不得 accepted、不得提交、不得要求用户继续做验收**。

用户已明确要求：暂时放弃刚才针对该症状的调度/前端刷新补丁，先比较单人与多人的架构，决定哪些模块应直接复用、哪些必须保留多人适配层。

## 当前分支与提交边界

- 分支：`P3-development`
- 已提交：
  - `495b8b5 P3-08: implement timeout takeover and recovery`
  - `a3802a8 P3-09: harden multiplayer security regression coverage`
  - `5521f34 P3-10: add recovery operations and observability`
- P3-11 尚未 accepted、尚未提交。
- 禁止部署 Preview/Production；P3-12 前禁止 Cloudflare 登录、创建云资源或部署。

## 工作区警告

`git status --short` 仍显示大量修改和未跟踪文件，包含多人 UI、Room/Authority、测试、ADR、文档等连续工作。它们并不都是本轮失败补丁，**严禁执行 `git reset --hard`、`git checkout --` 或批量删除**。

最近一次已明确撤回的尝试仅包括：

1. 把 `Room` 的机器人调度去重从时间戳改为 Authority 事件序号，以及新增的“同毫秒”P3-11 用例；
2. 在 `MultiplayerApp` 动作冲突后强制刷新个人投影，以及新增的对应组件断言。

上述两项已用定向 patch 移除。撤回后 `npm.cmd run test:p3-08` 为 4/4 通过，`git diff --check` 通过。不要在不了解用户新方向前重新加入这些补丁。

## 用户最后确认的浏览器症状

真实浏览器、单人真人 + 三个空座机器人时：

1. 机器人 C 领出 `66`；
2. 下家真人“曹操”选择 `99` 并点击出牌；
3. 画面显示的却像是机器人出了 `KK`，随后真人的“出牌/过牌”变灰，牌局仿佛变为四个机器人继续；
4. 真人动作后机器人 A 常等待数十秒到一分钟，而机器人 A 动作完成后另两个机器人又非常快地连续推进。

不要把这一现象直接归因于玩家误操作，也不要以“自动化通过”为由要求用户继续手测。下一阶段先做可观测、可重复的端到端诊断或重新组织 UI 复用边界。

## 已完成的复用分析

分析文件：

- `proj-info/phases/P3/P3-07-singleplayer-multiplayer-reuse-analysis.md`

结论：

- 必须直接共享：`packages/guandan-core` 的规则、`TableSession`、合法动作、`normal-vNext`、理牌算法、公开事件解释；
- 可以抽取后共享：单人牌桌的无状态展示和交互组件，例如牌面、公开动作层、手牌分组、选牌控制、牌桌框架；
- 必须保留多人专属适配：Room/AuthSession、Authority 个人投影、WebSocket/ACK/重连、心跳、断线托管、权威持久化与恢复；
- 不能复用：`SoloApp` 对本地完整状态的所有权、浏览器 `setTimeout` 机器人循环、IndexedDB 权威存档、“south 是唯一真人”的假设。

推荐目标结构是“共享的投影驱动牌桌组件 + 两个适配器”：

```text
guandan-core（规则、会话、合法动作、机器人、理牌）
        ↑
单人适配器：本地 TableSession -> 共享牌桌 props
多人适配器：Authority 个人投影 -> 相同共享牌桌 props
        ↑
多人 Room/Realtime/Authority：仅负责权威、协议、控制权和持久化
```

共享牌桌组件不能接收 `TableSession`、完整 `TableGame`、全量 `cardsById` 或其他座位手牌；它只应接收自己的手牌、公开牌面、`legalActions`、座位投影、可行动状态和动作回调。

## 关键代码定位

| 范围                                   | 文件                                                               |
| -------------------------------------- | ------------------------------------------------------------------ |
| 单人页面与本地机器人/本地 session 适配 | `frontend/src/App.tsx`                                             |
| 多人大厅、牌桌 UI、选牌                | `frontend/src/multiplayer/MultiplayerApp.tsx`                      |
| 多人 HTTP/WebSocket 客户端             | `frontend/src/multiplayer/client.ts`                               |
| 共享规则、会话、机器人、理牌           | `packages/guandan-core/src/games/guandan/`                         |
| 权威游戏恢复、投影和动作               | `backend/src/authority-game.ts`                                    |
| 房间、座位、存在状态、托管调度         | `backend/src/room.ts`                                              |
| 实时协议                               | `backend/src/realtime-room.ts`                                     |
| 座位/控制权/个人投影约束               | `proj-info/adr/ADR-0029-p3-seat-controller-and-view-projection.md` |
| 断线托管冻结策略                       | `proj-info/adr/ADR-0030-p3-disconnect-timeout-and-bot-takeover.md` |
| P3 测试矩阵                            | `proj-info/phases/P3/test-matrix.md`                               |
| 人工浏览器验收清单（当前不应执行）     | `proj-info/phases/P3/P3-11-local-browser-acceptance.md`            |

## 已知自动化结果及其局限

最近执行过：

- `backend/npm.cmd run test:p3-08`：4/4 通过（在撤回最近补丁后再次通过）；
- `backend/npm.cmd run test:p3-11`：此前为 7/7 通过；但该全量通过发生在已撤回的“同毫秒调度”实验期间，且未能复现用户浏览器症状，因此不能视为本问题验收；
- `frontend` 多人组件测试：14/14 通过；
- backend/frontend typecheck、frontend lint、Prettier、`git diff --check` 曾通过。

Windows/沙箱环境偶尔会对 `frontend/node_modules/.vite-temp` 或刚生成文档报 `EPERM`。这不等价于 Vite/Wrangler 仍在运行；曾用受控的 elevated Prettier 完成格式化。新 session 如遇同类锁，先检查进程，再使用最小范围格式命令，不要删除 `node_modules` 或工作区内容。

## 新 session 建议顺序

1. 阅读根 `AGENTS.md`、本交接、`P3-07-singleplayer-multiplayer-reuse-analysis.md`、ADR-0029/0030、`proj-info/phases/P3/tasks.md` 和 `git status --short`。
2. 把 P3-11 保持为 `in_progress` / 未验收状态；不得提交当前脏工作区。
3. 以复用分析为依据，先提出“共享投影驱动牌桌组件”的最小重构计划和受影响文件；这个计划会涉及 UI 架构，需在动手前请用户确认范围。
4. 实现时先为共享组件建立单人和多人两侧的固定交互测试；多人测试必须证明选中的具体 `cardIds` 原样抵达 Authority，且 UI 只根据 ACK 的个人投影更新手牌和桌面。
5. 在可复现浏览器症状前，不继续扩展 P3-11 测试矩阵，也不启动 P3-12。

## 本地运行（仅在重新获准测试时）

```powershell
cd D:\MyWorks\card-game\backend
npm.cmd run dev
```

```powershell
cd D:\MyWorks\card-game\frontend
npm.cmd run dev -- --host 0.0.0.0
```

本地 Worker 固定端口为 `8788`；多设备前端使用宿主机 LAN IP。服务已由用户停止；本交接不要求启动它们。
