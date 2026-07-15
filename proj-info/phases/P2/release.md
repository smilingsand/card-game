# P2 发布记录

状态：待 iPhone Safari 真机复测后完成 P2-06 验收。

- Preview：<https://card-game-mf2xxwu9v-wentop.vercel.app>
- Production：<https://card-game-wentop.vercel.app>
- 当前 Production deployment：`dpl_GqnbABu5EoMVqacoQjgEyJwMo1k5`（Ready）
- 部署详情：<https://vercel.com/wentop/card-game/GqnbABu5EoMVqacoQjgEyJwMo1k5>
- 回滚目标：`https://card-game-ez2wq9nml-wentop.vercel.app`

Production 已通过 Chrome 页面与移动视口复核。PWA 的真机安装/离线启动/更新提示仍需按 `test-matrix.md` 完成。

2026-07-15：本地已完成下一次发布内容的质量验收：横排手牌占位改为与牌面同宽；正式牌桌改接普通策略机器人，并以固定牌例防止无必要炸弹、拆小王对子和拆 10-J-Q-K-A 自然顺子。串行全量回归为 24 个测试文件 / 118 项通过，生产构建输出位于 `temp/strategy-ui-fix-build`。该变更尚未发布到上述 Production deployment。

2026-07-15：已按产品授权关闭 `wentop/card-game` 的 Vercel SSO Deployment Protection；无登录态请求 `https://card-game-wentop.vercel.app/` 返回 HTTP 200，不再重定向至 `vercel.com/sso-api`。
