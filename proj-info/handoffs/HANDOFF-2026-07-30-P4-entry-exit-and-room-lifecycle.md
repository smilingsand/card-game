# HANDOFF-2026-07-30：P4 入口、退出、房间回收与继续游戏

## 当前分支与提交

- 分支：`codex/p3-11-singleplayer-table-modularization`
- 入口与房间流程提交：`fcd9f40 P4: resume multiplayer game from lobby`。
- 后续相关提交：`444b313`（结墩展示稳定化）、`d7b2cdd`（任意真人座位贡还牌）、`a7a5f0f`（首页进入单人新赛局）和 `bb566c9`（隐藏单人机器人思考提示）。

## 已完成的产品流程

1. 根 URL 显示首页，提供“单人掼蛋游戏”和“多人掼蛋游戏”。
2. 单人右上角“退出”返回首页；单人 IndexedDB 存档不受影响。
3. 多人牌桌右上角“退出”只返回该房间大厅，不销毁权威牌局。
4. 牌桌退出后大厅显示“继续游戏”；它重新读取该玩家当前 `game-view` 个人投影，恢复同一局，不重开、不重发牌。
5. 多人大厅只保留右上角“退出”：
   - 房主：关闭房间，通知所有在线客户端回首页，并清除 Room、Authority、Realtime、bot task、alarm、presence、座位、事件和本地持久记录。
   - 非房主：提交 `presence=false`，关闭自身 WebSocket 并回首页；房间继续运行，既有离线托管逻辑接管。
6. 删除了大厅底部重复的“关闭房间／退出房间”按钮。
7. `npm.cmd run p4:dev` 的 Vite 监听改为 `0.0.0.0:5173`。本机 URL 为 `http://127.0.0.1:5173/`；局域网 URL 为 `http://<本机IP>:5173/`。后端仍只监听 `127.0.0.1:8788`。
8. 单人游戏从首页进入时总是重新开赛并覆盖旧本地存档；单人牌桌内部刷新仍可以恢复当前赛局。
9. 单人和多人牌桌的底部本人信息布局一致；多人左右玩家的公开出牌或“不要”展示向牌桌中央偏移，避免贴近姓名与剩余牌数。

## 关键实现位置

- 首页、模式切换：`frontend/src/App.tsx`、`frontend/src/App.css`
- 多人退出、继续游戏与投影抑制：`frontend/src/multiplayer/MultiplayerApp.tsx`
- HTTP `close`/离开与 WebSocket `roomClosed`：`frontend/src/multiplayer/client.ts`
- 服务端关闭协调：`backend/src/room.ts`、`backend/src/realtime-room.ts`、`backend/src/authority-game.ts`、`backend/src/index.ts`
- 本地启动与局域网监听：`tools/start-p3-local.ps1`
- 决策：`proj-info/adr/ADR-0034-p4-explicit-room-exit-and-resume.md`

## 验证证据

2026-07-30 已通过：

```powershell
npm.cmd run test:run --workspace frontend -- src/App.test.tsx src/multiplayer/MultiplayerApp.test.tsx
npm.cmd run test:p3-10 --workspace backend
npm.cmd run test:p3-06 --workspace backend -- -t "P4:"
npm.cmd run build --workspace frontend
npm.cmd run typecheck --workspace backend
npm.cmd run lint --workspace frontend
```

- 前端相关流程：44 项通过（后续“继续游戏”定向多人套件为 23 项通过）。
- P3-10：5 项通过，包含房主关闭后 host/guest 均无法再读取房间。
- P4 Realtime 定向用例通过，确认 `roomClosed` 通知。
- 前端 build、前后端 typecheck、前端 lint 和针对性 Prettier 检查通过。

Vitest 输出仍有既有的 React `act(...)` 警告；测试不失败。完整 `npm.cmd run test:p3-06 --workspace backend` 在本机连续两次失败于既有“Room 绑定真人逻辑座位”空座机器人调度时序断言：期望 eventSequence 2/current south，实际有时为 eventSequence 0/current north。新增 P4 Realtime 用例单独通过；此不稳定项尚未修复，后续应以独立 P4/P3-11 稳定性任务处理，勿在没有复现与日志的情况下改动规则或退出流程。

后续牌桌 UI 调整（2026-07-30）验证：`npm.cmd run lint --workspace frontend` 与 `npm.cmd run build --workspace frontend` 通过。定向 `MultiplayerTable` 套件为 8/9；未通过项是既有的手牌排序测试把“过牌”控制按钮也纳入“你的手牌”的按钮查询，和本次 CSS 展示位置调整无关。

## 运行与人工验收

```powershell
npm.cmd run p4:dev
```

正常关闭前台终端使用 `Ctrl+C`；终端被强制关闭后使用 `npm.cmd run p4:stop`。不要另外单独启动 Vite 或 Wrangler。若请求再次持续数秒或出现 503，先保存 `temp/p4-backend-dev.log` 和 `temp/p4-backend-dev.err.log`，按 2026-07-29 handoff 的步骤停止并归档 `backend/.wrangler/state`，不要直接删除。

下一次人工验收建议覆盖：

1. 首页进入单人、多人及两种退出。
2. 多人牌桌退出到大厅；机器人动作期间不闪回牌桌；点击“继续游戏”恢复同一局。
3. 非房主大厅退出回首页且房间继续；房主大厅退出时其他在线浏览器自动回首页。
4. `127.0.0.1` 与本机局域网 IP 的 5173 入口均可访问。
