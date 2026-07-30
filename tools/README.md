# 本地 P4 开发工具

`start-p3-local.ps1` 用于启动本地多人联调环境，并负责其进程生命周期。日常本地联调只通过下面两个 npm 脚本管理服务；不要单独启动 Vite 或 Wrangler。

```powershell
# 启动：在仓库根目录运行，终端会持续镜像前后端日志。
npm.cmd run p4:dev

# 清理：如果启动终端被强制关闭、存在残留进程或端口被占用，
# 在仓库根目录的另一个终端运行。
npm.cmd run p4:stop
```

正常结束仍应在执行 `p4:dev` 的同一终端按 `Ctrl+C`，使脚本的 `finally` 块按正常路径关闭两个进程树；`p4:stop` 是该正常路径之外的确定性清理与恢复命令。

```powershell
# 在仓库根目录运行。Vite 会在当前终端前台运行；按 Ctrl+C 会先停止 Vite，
# 再由脚本终止 Wrangler 及其 workerd 子进程。
.\tools\start-p3-local.ps1

# 若此前窗口被强制关闭，按固定开发端口清理残留进程树。
.\tools\start-p3-local.ps1 -StopOnly
```

也可从仓库根目录使用等价命令：

```powershell
npm.cmd run p4:dev
npm.cmd run p4:stop
```

Vite 绑定 `0.0.0.0:5173`：本机可使用 `http://127.0.0.1:5173/`，同一局域网设备可使用 `http://<本机IP>:5173/`。Wrangler 后端仍只监听本机 `127.0.0.1:8788`，由 Vite 代理转发；不要把 8788 直接暴露到局域网。

脚本只处理 P4 本地开发固定端口 `5173`（Vite）与 `8788`（Wrangler）。它会使用
`taskkill /T` 终止监听进程及其子进程，避免 `workerd` 或 Vite 的 Node 子进程残留。
不要将前端或后端以脱离终端的 `Start-Process` 方式单独启动；那种进程不属于你按下
`Ctrl+C` 的控制台，无法由该组合键可靠终止。统一脚本仅在后台托管后端，Vite 始终在
执行 `p4:dev` 的前台终端中运行。
