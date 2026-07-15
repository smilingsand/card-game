# P1 发布记录

状态：已发布（P1-20，2026-07-15）

- GitHub：`main` 已推送至 `smilingsand/card-game`；本次 Production 对应提交 `0a775840b4c2d6685032556137c28aa6315e9af8`。
- Vercel Project：`wentop/card-game`，Root Directory 为 `frontend`，使用 Hobby 计划。
- Production：[https://card-game-wentop.vercel.app](https://card-game-wentop.vercel.app)
- 部署详情：[Vercel Inspect](https://vercel.com/wentop/card-game/5KQwZTgQ7REFJcdpFUxxRX51g8tJ)
- 验收：Vercel 云端执行 `npm run build` 成功；2026-07-15 P1 完结复核再次通过 `format:check`、typecheck、lint、全量 Vitest（19 个测试文件 / 98 项，含 1,000 局自动对局）和生产构建。P1 发布时该 Production URL 的 SSO 部署保护会要求匿名访问者登录；P2-06 已获产品明确授权并于 2026-07-15 关闭，当前匿名访问以 P2 `release.md` 为准。
- 回滚目标：这是该项目首个 Production 部署；尚无前一 Production 版本。后续可在 Vercel 将本次部署作为可回滚版本。
