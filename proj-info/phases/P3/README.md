# P3：多人联网掼蛋

## 状态

P3-01 已验收。目标是在不改变 `guandan-v5` 规则的前提下，提供一间房间 1–4 名真人、其余空座由 `normal-vNext` 控制的权威多人游戏；下一项可启动任务为 P3-02。

## 入口

- [任务与验收](tasks.md)
- [测试矩阵](test-matrix.md)
- [发布记录](release.md)
- [P3 ADR](../../adr/ADR-0025-p3-cloudflare-authoritative-runtime.md)

所有后端可执行代码、配置、测试与部署清单均在仓库根目录的 `backend/`。本地开发、POC、自动测试和浏览器联调固定为“本地 Vite → 本地 Wrangler Worker → 本地 SQLite-backed Durable Object”；不需要 Cloudflare 账号，也不创建云资源或产生 Cloudflare 费用。公网 Preview/Production 才是“Vercel Hobby 前端/PWA → WebSocket Hibernation → Cloudflare Worker + SQLite-backed Durable Object”，且 P3-12 必须先等待用户完成 Cloudflare Free 账号和其本机 `npx wrangler login` 授权。
