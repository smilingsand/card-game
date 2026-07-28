# 本地 P4 开发工具

`start-p3-local.ps1` 用于启动本地多人联调环境，并负责其进程生命周期。

```powershell
# 在仓库根目录运行；Ctrl+C 会终止 Vite、Wrangler 及其 workerd 子进程。
.\tools\start-p3-local.ps1

# 若此前窗口被强制关闭，按固定开发端口清理残留进程树。
.\tools\start-p3-local.ps1 -StopOnly
```

脚本只处理 P4 本地开发固定端口 `5173`（Vite）与 `8788`（Wrangler）。它会使用
`taskkill /T` 终止监听进程及其子进程，避免 `workerd` 或 Vite 的 Node 子进程残留。
不要将前端或后端以脱离终端的 `Start-Process` 方式单独启动；那种进程不属于你按下
`Ctrl+C` 的控制台，无法由该组合键可靠终止。
