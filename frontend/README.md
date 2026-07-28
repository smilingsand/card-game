# 前端应用

React + TypeScript + Vite 前端。单人本地掼蛋保留 IndexedDB 存档和 PWA 离线静态壳；P3 多人模式通过独立的 HTTP/WebSocket 客户端消费服务端个人投影，不读取、写入或恢复联机权威牌局状态。

## 本地命令

在本目录运行 `npm.cmd install` 后：

```powershell
npm.cmd run format:check
npm.cmd run typecheck
npm.cmd run lint
npm.cmd run test:run
npm.cmd run benchmark:p2
npm.cmd run build
```

## P3 本地联调

先在 `backend/` 按 `.dev.vars.example` 配置仅本机使用的邀请密钥，并启动本地 Wrangler：

```powershell
cd ..\backend
npm.cmd run dev
```

另开终端启动 Vite：

```powershell
cd ..\frontend
npm.cmd run dev
```

Vite 会把同源 `/v1` HTTP 和 WebSocket 请求代理到 `http://127.0.0.1:8788`；`backend` 的 `npm.cmd run dev` 固定使用该端口。仅当 Worker 明确以其他端口启动时，才在启动 Vite 前设置 `P3_LOCAL_WORKER_ORIGIN`。此流程只使用本地 SQLite-backed Durable Object，不需要 Cloudflare 账号或部署。

## Vercel 预案

Vercel 项目为 `wentop/card-game`：Repository Root 保持仓库根目录，Project Root Directory 设为 `frontend`。使用 Git 集成时，功能分支为 Preview，`main` 为 Production。Service Worker 只缓存版本化静态壳，不缓存 IndexedDB 牌局数据；部署后应按根目录 P2 验收矩阵复测更新与离线启动。
