# P2 发布记录

状态：P2-06 `accepted`（2026-07-16）。

- Preview：<https://card-game-mf2xxwu9v-wentop.vercel.app>
- Production：<https://card-game-wentop.vercel.app>
- 当前 Production deployment：`dpl_6i79U85p4bAstRwUowj3guxaETAf`（Ready，`guandan-v5`）
- 部署详情：<https://vercel.com/wentop/card-game/6i79U85p4bAstRwUowj3guxaETAf>
- 回滚目标：`https://card-game-2mzut8vby-wentop.vercel.app`

Production 已通过 Chrome 页面与移动视口复核。2026-07-16，用户已在 iPhone Safari 使用正式 HTTPS 地址完成主屏安装、关闭 Safari 后离线启动，以及恢复网络后的更新提示真机清单；P2-06 据此验收通过。

验收复核：Production `dpl_6i79U85p4bAstRwUowj3guxaETAf` 为 Ready，提交为 `d8d4e2b`；正式入口、Manifest 和 Service Worker 均返回 HTTP 200，离线壳缓存版本为 `guandan-v5`。Vercel 构建耗时 7 秒，近 7 天未发现运行时错误。

2026-07-15：本地已完成下一次发布内容的质量验收：横排手牌占位改为与牌面同宽；正式牌桌改接普通策略机器人，并以固定牌例防止无必要炸弹、拆小王对子和拆 10-J-Q-K-A 自然顺子。串行全量回归为 24 个测试文件 / 118 项通过，生产构建输出位于 `temp/strategy-ui-fix-build`。该变更尚未发布到上述 Production deployment。

2026-07-15：已发布规则修复：连续牌中的级牌恢复为普通点数语义，规则版本升级为 `guandan-v5`；同时修正南家“不要”与公开牌下缘的对齐。`d8d4e2b` 的全量串行回归为 24 个测试文件 / 119 项通过；Production `dpl_6i79U85p4bAstRwUowj3guxaETAf` 已 Ready，正式 URL 匿名 HTTP 200 且公开 bundle 已核对包含 `guandan-v5`。

2026-07-15：已按产品授权关闭 `wentop/card-game` 的 Vercel SSO Deployment Protection；无登录态请求 `https://card-game-wentop.vercel.app/` 返回 HTTP 200，不再重定向至 `vercel.com/sso-api`。
