# P1 完结交接记录

状态：已完成，2026-07-15

## 完成范围

P1-01 至 P1-20 均已验收。P1 交付浏览器内的单人本地掼蛋：南家真人、东/北/西三家基础机器人、纯 TypeScript 规则、版本化事件流与 IndexedDB 存档、手动理牌、明牌测试、连续多局、等级、进贡/还贡/抗贡和基础提示策略。

## 当前基线

| 项目 | 当前值 |
| --- | --- |
| 规则版本 | `guandan-v4` |
| 存档 schema | 4 |
| 首局 | 双方打 2，南家首出 |
| 后续级牌 | 上一局头游方升级后的等级 |
| 行牌方向 | 南 → 东 → 北 → 西 → 南 |
| 当前 Production | `https://card-game-wentop.vercel.app` |
| Production 访问限制 | P1 发布当时启用了 Vercel SSO 部署保护；P2-06 已获产品授权并于 2026-07-15 关闭。当前匿名访问和回滚信息以 `../P2/release.md` 为准。 |

## 后续开发的事实入口

1. 产品规则：[掼蛋规则(被采用)_V1.md](../../../docs/掼蛋规则(被采用)_V1.md) 与 [resolved-rules.md](../../../docs/resolved-rules.md)。
2. 基础机器人：[基础机器人策略说明_V1.md](../../../docs/基础机器人策略说明_V1.md)。
3. 架构与边界：[architecture.md](../../../docs/architecture.md) 与根目录 `AGENTS.md`。
4. 任务依赖与验收记录：[P1-P3-execution-plan.md](../P1-P3-execution-plan.md)。
5. 规则修订：ADR-0011（南家首局）和 ADR-0012（动态级牌）；旧 ADR 的替代关系已在原文标注。
6. 发布与回滚：[release.md](release.md)。

## 验收与质量门禁

本次完结已在 `frontend/` 依次通过 `npm.cmd run format:check`、`npm.cmd run typecheck`、`npm.cmd run lint`、`npm.cmd run test:run` 和 `npm.cmd run build`。Vitest 为 19 个测试文件 / 98 项通过，包含 1,000 局自动对局；生产构建通过。实际发布证据见 [release.md](release.md)。

P2-01 至 P2-05 已验收，P2-06 已完成发布和 Chrome 验收，仍待 iPhone Safari 主屏离线启动的最终人工复测。下一开发阶段为 P3，入口见 `../P1-P3-execution-plan.md`。
