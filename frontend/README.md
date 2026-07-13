# 前端应用

P1-01 初始化的 React + TypeScript + Vite 前端。当前不包含任何游戏规则或牌桌 UI。

## 本地命令

在本目录运行 `npm.cmd install` 后：

```powershell
npm.cmd run format:check
npm.cmd run typecheck
npm.cmd run lint
npm.cmd run test:run
npm.cmd run build
```

## Vercel 预案

创建 Vercel 项目时，Repository Root 保持仓库根目录，Project Root Directory 设为 `frontend`。使用 Git 集成：功能分支为 Preview，`main` 为 Production。
