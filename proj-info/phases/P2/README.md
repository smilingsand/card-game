# P2：移动/PWA 与策略机器人

状态：`accepted`（2026-07-16）

P2-01 至 P2-05 已验收并在本地提交。P2-02 的 PWA 离线壳、缓存版本与更新确认已完成 Chrome 验收；P2-06 已发布 Preview 与 Production，并于 2026-07-16 完成 iPhone Safari 正式 HTTPS 安装、离线启动和更新提示真机验收。

2026-07-22 的后续策略收敛已将 normal-vNext 设为唯一产品机器人；机器人与提示均使用
完整规则 legalActions 和 BotView，不再暴露 normal-v1 或 expert-24 profile。该变更尚未
更新此处列出的历史 Production 部署记录，下一次发布前须重新完成 Preview/Production 验收。

事实来源：`../P1-P3-execution-plan.md`、`tasks.md`、`test-matrix.md` 与 `release.md`。
