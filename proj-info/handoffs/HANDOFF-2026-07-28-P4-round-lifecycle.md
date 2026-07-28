# HANDOFF-2026-07-28 — P4 多人赛局生命周期与牌桌一致性

## 本次完成

- Authority 个人投影新增仅公开的赛局摘要：局号、双方级牌、当前级牌所属队伍、上一局完成顺序、公开进贡摘要和提示；不下发 `TableSession`、seed、完整牌表或他人手牌。
- 多人 `MultiplayerTable` 复用单人已有 `match-scoreboard` 样式和 `TableView` 画布，不再建立第二套桌面坐标；多人标题下显示与单人一致的上一局完成顺序和下一局提示。
- `Room.reconcile()` 在当前局完成时调用既有 Authority `/next-round`，保留房间、身份、座位和比赛 `gameId`，并推进 `roundNumber`/事件序号后重新调度下一局。
- 已消除已恢复房间仍显示“请选择名称后创建或加入房间”的初始 notice 残留。
- ADR-0033 替代 ADR-0030 中在线真人 30 秒回合托管：在线真人不设出牌超时；仅在心跳确认断线、当前回合宽限结束后临时托管一个动作。bot task 继续使用独立短思考延迟。

## 本次测试

- `frontend`: format check、lint、typecheck、54 项单测、build 均通过。
- `backend`: typecheck、`test:p3-08`（4 项）和 `test:p4-01`（3 项）通过。
- P4-01 新增受控完成局测试：同一比赛 `gameId` 保留、事件序号递增、`roundNumber` 进入 2、上一局完成顺序和公开摘要存在。
- `test:core` 通过。

## 已知基线问题

- 全量后端命令超过外层 124 秒时限，已改为分批。
- `backend test:p3-03` 当前有 4 个旧夹具失败：直连 Authority 命令缺少当前协议必需的 `expectedEventSequence`、新比赛 seed/快照断言与既有 P4 策略不一致。此次 diff 未修改新比赛、命令校验、seed 或快照实现；该问题须单列 P3 测试夹具对齐任务，不能在本次 UI/生命周期修复中顺带改写。

## 待人工验收

1. 用 `npm.cmd run p4:dev` 启动，浏览器打开输出的 Vite 地址。
2. 创建“曹操（south）+ 三机器人”房间，完整打完一局。
3. 验证下一局自动出现：页面仍在同一房间、标题下显示完成顺序、牌桌左上显示双方级牌与进贡信息。
4. 验证机器人每步为可见的约 1 秒短延迟；在线真人停留超过 30 秒不会被接管。
5. 关闭前台 `p4:dev` 终端使用 Ctrl+C；若需兜底清理，在另一终端运行 `npm.cmd run p4:stop`。
