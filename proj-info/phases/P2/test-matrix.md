# P2 验收矩阵

## P2.7 本地策略稳定化（2026-07-22）

| 范围 | 证据 | 结果 |
| --- | --- | --- |
| normal-vNext 固定牌例 | `normal-vnext-bot.test.ts`：41 项 | 通过 |
| 策略指标 | `normal-vnext-metrics.test.ts`：1 项 | 通过 |
| 牌桌入口 | `table-controller.test.ts`：11 项 | 通过 |
| 应用界面 | `App.test.tsx`：19 项 | 通过 |
| 静态检查 | `typecheck`、`lint` | 通过 |
| 明牌叠层 | 后出牌座位层级高于先出牌座位 | 通过 |
| Production 部署与公开入口 | Vercel `wentop/card-game` 远端构建；`https://card-game-wentop.vercel.app/` 匿名 HTTPS HTTP 200 | 通过 |
| Production 人工试玩 | 用户于 2026-07-23 在正式入口完成试玩并明确确认验收 | 通过 |
| Preview 与 PWA/真机复测 | 未单独创建 P2.7 Preview；未来移动端/PWA 风险变更另行复测 | 本版不适用 |

P2-06 的线上 PWA、离线和 iPhone Safari 证据仍保留在历史发布记录中；不得把它们当作 P2.7 的发布证据。
