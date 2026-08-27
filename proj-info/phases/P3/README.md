# P3：多人联网掼蛋

## 状态

P3-01 至 P3-10 已验收；P3-11 已完成自动验证，等待本地浏览器人工验收。目标是在不改变 `guandan-v5` 规则的前提下，提供一间房间 1–4 名真人、其余空座由 `normal-vNext` 控制的权威多人游戏；本阶段仅使用本地 Vite/Miniflare/SQLite Durable Object，不部署 Cloudflare。

## 入口

- [任务与验收](tasks.md)
- [测试矩阵](test-matrix.md)
- [发布记录](release.md)
- [P3 ADR](../../adr/ADR-0025-p3-cloudflare-authoritative-runtime.md)

## P4 本地补充

P4 本地浏览器入口已改为首页：单人游戏退出回首页；多人牌桌退出先回多人大厅，并可“继续游戏”重新读取同一权威个人投影；大厅右上角退出由房主关闭整个房间，非房主仅释放自身连接。详见 [ADR-0034](../../adr/ADR-0034-p4-explicit-room-exit-and-resume.md) 与 [最新 P4 交接](../../handoffs/HANDOFF-2026-07-30-P4-entry-exit-and-room-lifecycle.md)。

所有后端可执行代码、配置、测试与部署清单均在仓库根目录的 `backend/`。本地开发、POC、自动测试和浏览器联调固定为“本地 Vite → 本地 Wrangler Worker → 本地 SQLite-backed Durable Object”；不需要 Cloudflare 账号，也不创建云资源或产生 Cloudflare 费用。公网 Preview/Production 才是“Vercel Hobby 前端/PWA → WebSocket Hibernation → Cloudflare Worker + SQLite-backed Durable Object”，且 P3-12 必须先等待用户完成 Cloudflare Free 账号和其本机 `npx wrangler login` 授权。

根目录 `settings.ini` 默认将 `multiplayers-game` 设为 `false`，以支持只发布单人版。执行本地多人联调前必须改为 `true` 并重启 Vite；此开关不部署后端，也不能替代 P3-12 的 Preview/Production 验收。
