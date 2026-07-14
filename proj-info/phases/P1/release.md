# P1 发布记录

状态：已发布（P1-20，2026-07-15）

- GitHub：`main` 已推送至 `smilingsand/card-game`；本次 Production 对应提交 `0a775840b4c2d6685032556137c28aa6315e9af8`。
- Vercel Project：`wentop/frontend`，Root Directory 为 `frontend`，使用 Hobby 计划。
- Production：[https://frontend-sand-three-66.vercel.app](https://frontend-sand-three-66.vercel.app)
- 部署详情：[Vercel Inspect](https://vercel.com/wentop/frontend/kR9XTf921khjaQxYsJcTujDr6Den)
- 验收：Vercel 云端执行 `npm run build` 成功；本地全量 19 个测试文件 / 98 项通过，typecheck、lint、生产构建通过；Production URL 返回 HTTP 200，页面标题为“`双副牌扑克游戏平台`”。
- 回滚目标：这是该项目首个 Production 部署；尚无前一 Production 版本。后续可在 Vercel 将本次部署作为可回滚版本。
