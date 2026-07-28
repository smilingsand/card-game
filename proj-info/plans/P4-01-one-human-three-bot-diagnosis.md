# P4-01 一人三机器人动作生命周期诊断

状态：第一阶段完成；等待用户确认根因后才实施调度、`turnGeneration`、ACK/pending 与重开修复。

## 固定复现场景

- 本地 Miniflare，`P3_TEST_MODE=true`；不部署。
- south：真人“曹操”；east / north / west：空座 `normal-vNext` 机器人。
- 固定 seed 标识：`fixture-c`（seed 明文只存在测试绑定，未写入日志或测试输出）。
- south 首出合法对子 `99`，命令 ID：`p4-01-human-99`。

## 测试专用观测边界

`backend/test/p4-01-single-human-bot-lifecycle.local.test.mjs` 通过只在
`P3_TEST_MODE=true` 下可访问的 Durable Object 诊断端点读取记录。生产路由不开放这些端点。

每项记录包含 room/game ID、派生的 `turnGeneration`
(`gameId:eventSequence:currentSeat`)、当前行动座位、控制模式/控制者、命令 ID、预期和权威事件序号、
提交与应用实体牌 ID、takeover deadline、机器人任务的计划/执行时间，以及重开结果。

日志不包含 Cookie、邀请码、完整手牌、`cardsById` 或 seed 明文。

## 第一阶段证据

1. `p4-01-human-99` 的 `submittedCardIds` 与 Authority 已存储动作的
   `appliedCardIds` 完全相同。该链路未将 `99` 替换为 `KK`。
2. 人类 ACK 后，east、north、west 三个机器人记录为相同的
   `scheduledAt` 与 `executedAt`；这证明当前 `Room.reconcile()` 的单次循环会连续推进多家，
   没有独立 bot think delay。
3. 当前仅有 `bot_dispatch_clock.dispatched_at` 的同毫秒抑制；它不是回合 token，且调度候选只包含
   30 秒真人 deadline/心跳 deadline。第二个固定夹具已记录 east 在 `botDispatchedAt === now` 时进入
   `bot.dispatch.suppressed`，其 `scheduledAt === now + 30_000`；因此机器人被该抑制分支跳过时，下一次唤醒
   会退化到回合截止。
4. 人类控制权恢复依赖 presence/takeover 分支，未使用可持久化的 `turnGeneration`。旧 alarm 与新回合之间
   尚没有 token 隔离；这是下一阶段修复目标，但第一阶段未改变该行为。
5. 固定夹具模拟 south 断线满十秒后，日志依次记录 south `takeover.changed` 为 bot 和在下一动作边界恢复为 human；
   因而“永久代打”并不是设计的预期行为，而是旧调度与控制状态竞争时缺少 generation 隔离的风险。
6. `restart-match` 与 `restart-round` 均得到 Authority ACK 并记录新 game ID / 事件序号；后端路由和房主校验在固定夹具中没有无响应。
   浏览器的“无响应”仍需在下一阶段以 pending/投影关联日志验证，而不是归因于按钮缺少 onClick。

## 本阶段验证

- `backend/npm.cmd run typecheck`
- `backend/npm.cmd run test:p4-01`：1/1
- `backend/npm.cmd run test:p3-08`：4/4
- `backend/npm.cmd run test:p3-11`：6/6（约 215 秒）
- `frontend/npm.cmd run format:check`
- `git diff --check`
