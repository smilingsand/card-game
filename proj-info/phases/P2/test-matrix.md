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
| 发布验收 | 新 Preview/Production 与真机复测 | 待执行 |

P2-06 的线上 PWA、离线和 iPhone Safari 证据仍保留在历史发布记录中；不得把它们当作 P2.7 的发布证据。
