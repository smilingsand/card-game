# 前端应用

React + TypeScript + Vite 前端，当前提供单人本地掼蛋：确定性规则引擎、1 名南家人类与 3 名普通策略机器人、触摸/响应式牌桌、IndexedDB 存档以及 PWA 离线静态壳。

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

## Vercel 预案

Vercel 项目为 `wentop/card-game`：Repository Root 保持仓库根目录，Project Root Directory 设为 `frontend`。使用 Git 集成时，功能分支为 Preview，`main` 为 Production。Service Worker 只缓存版本化静态壳，不缓存 IndexedDB 牌局数据；部署后应按根目录 P2 验收矩阵复测更新与离线启动。
