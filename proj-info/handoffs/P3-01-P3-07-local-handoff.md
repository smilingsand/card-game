# P3-01 至 P3-07 本地交接

- 分支：`P3-development`；仅本地提交，未推送或部署。
- 已验收：P3-01 至 P3-07；下一任务：P3-08（超时、断线等待、机器人托管与安全交接）。
- 本地结构：Vite `frontend/` → Wrangler/Miniflare SQLite DO `backend/`；P3-12 前禁止 Cloudflare 登录、部署或云资源。
- `packages/guandan-core` 是唯一规则源码；前后端只经包名使用。
- P3 使用 64 位小写十六进制的 256 位 seed：新比赛/下一局各生成新 seed；恢复、审计、受控重放复用同局 seed。
- 逻辑顺序固定：south → east → north → west；控制权为 `subject → roomId → seat`，客户端 actor 不可信。
- 客户端只接收个人投影，不能得到 seed、其他手牌或隐藏评估；多人状态不写 IndexedDB 单机存档。
- 本地密钥：复制 `backend/.dev.vars.example` 为未提交的 `backend/.dev.vars` 后生成邀请 HMAC 密钥。
- 验证：后端 P3-03/04 14 项、P3-05 3 项、P3-06 4 项；前端全量 29 项、typecheck/lint/build；Vite→Wrangler 冒烟 `/health` 200、`/v1/session` 201。
- P3-08 必须沿用 Room → Authority 控制权链；P3-09 需做四视角信息泄露和压力回归；P3-12 前公网部署需用户注册 Cloudflare Free 并自行执行 `npx wrangler login`。
