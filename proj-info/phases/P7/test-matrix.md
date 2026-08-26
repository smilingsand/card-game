# P7 测试矩阵

## P7-00（accepted）

| 验收项 | 证据 | 结果 |
| --- | --- | --- |
| 运行器可导入与可单测 | `frontend/scripts/normal-vnext-simulation-runner.test.ts` | 依赖注入下验证固定 seed 调度、报告写入和失败局拒绝；无需 CLI 或真实文件系统。 |
| CLI 薄封装 | `frontend/scripts/normal-vnext-simulation.ts` | 仅解析/校验参数并调用 `runNormalVNextSimulation`；npm 命令使用 `vite-node --script` 转发业务参数。 |
| 固定 seed 自动对局 | `npm.cmd run guandan:normal-vnext-simulation -- --profile=normal-vNext --seeds=0 --games-per-seed=1 --max-turns=1000 --output-dir=D:\\MyWorks\\card-game\\temp\\p7-00-runner-smoke` | 2026-08-26：完成 1/1，126 个动作，结算顺序 north/south/west/east；非法动作和最大回合失败均为 0。报告仅位于忽略的 `temp/`。 |
| 核心回归 | `cd frontend; npm.cmd run test:core` | 2026-08-26 通过，含新增运行器 2 项测试。 |
| 类型、lint、格式 | `cd frontend; npm.cmd run typecheck; npm.cmd run lint; npm.cmd run format:check` | 2026-08-26 通过。 |

运行更大的固定 seed 集合属于 P7-05 收敛门槛；当前受控执行环境对多 seed 长运行会提前结束且不写报告，已保留为环境限制，不以单 seed 冒烟替代该门槛。

## P7-01（accepted）

| 验收项 | 证据 | 结果 |
| --- | --- | --- |
| 已公开牌面投影 | `public-action-projection.ts` 与 `strategy-observation.test.ts` | 只从 `action.applied` 的已打出 card ID 解析 `{id, suit, rank}`；不返回 `deckIndex`、牌堆或未出牌。 |
| 纯 observation 重建 | `createStrategyObservation` 固定牌例 | 按 event sequence 排序；相同公共投影的逆序输入得到相同 observation。 |
| 旧投影兼容 | 同一固定牌例 | 没有 `publicActions` 的旧 BotView 返回空公开牌统计，不抛错或反查隐藏牌。 |
| 四座泄露边界 | 同一固定牌例与 `BotView` 类型断言 | 四座共享相同公开牌事实，只改变自己/队友/对手座位关系；输出无 `seed`、`opponentHands`。 |
| 连续赛局上下文与重放 | `table-session.test.ts`、`secure-seed.test.ts` | 上下文从 MatchSession 纯函数生成；存档恢复后重建相同上下文，secure seed 回放等价仍通过。 |
