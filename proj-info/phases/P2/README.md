# P2：移动/PWA 与策略机器人

状态：`ready_for_acceptance`（2026-07-15）

P2-01 至 P2-05 已验收并在本地提交。P2-02 的 PWA 离线壳、缓存版本与更新确认已完成 Chrome 验收；P2-06 已发布 Preview 与 Production，等待 iPhone Safari 的正式 HTTPS 安装/离线复测。

最新回归修复已部署到 Production：横排手牌占位与牌面同宽；正式牌桌接入普通策略机器人，避免无必要炸弹、拆小王对子和拆自然顺子；连续牌型中的级牌按普通点数比较，规则版本为 `guandan-v5`。南家“不要”与公开出牌牌面的下缘对齐。固定牌例及 24 个测试文件 / 119 项串行回归均通过。

事实来源：`../P1-P3-execution-plan.md`、`tasks.md`、`test-matrix.md` 与 `release.md`。
