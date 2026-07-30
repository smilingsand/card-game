# 双副牌扑克游戏平台

可扩展的网页扑克游戏平台；当前可玩的产品是单人本地掼蛋（1 名人类南家 + 3 个机器人）。

## 当前版本

**P2.7 - normal-vNext 策略稳定化（Production，2026-07-23）**

- 唯一产品机器人和“提示”策略：普通 normal-vNext。
- normal-v1 仅作离线历史对照；P2.5 expert-24 已撤销为可恢复 Git 历史，详见 [ADR-0024](proj-info/adr/ADR-0024-normal-vnext-strategy-replacement.md)。
- normal-vNext 只消费 BotView 和规则层 `legalActions`，不读取隐藏手牌。
- 本地版本已包含：尾局下家阻断、合法动作兜底、自然中小结构争牌、控制资源保护，以及明牌时按出牌先后显示覆盖关系。
- P2.7 已部署到 Vercel Production 并完成用户人工试玩验收；正式入口为 `https://card-game-wentop.vercel.app/`。未来的移动端/PWA 风险变更按需单独复测。

P3-01 至 P3-10 已在本地完成验收；P3-07 与 P3-11 仍等待四客户端人工验收。当前 P4 工作在 `codex/p3-11-singleplayer-table-modularization` 分支继续多人牌桌复用、动作生命周期和本地运行时稳定性收口；尚未部署。当前多人版本仅在本地 Vite、Wrangler/Miniflare 与 SQLite-backed Durable Object 中验证。入口为首页的单人/多人选择；多人支持创建/加入、准备/开始、牌桌退出到大厅、继续同一权威牌局，以及大厅右上角退出（房主关闭房间，非房主释放自身连接）。本机启动和故障恢复见 [P4 最新交接](proj-info/handoffs/HANDOFF-2026-07-30-P4-entry-exit-and-room-lifecycle.md)。

单人模式从首页进入时始终重新开赛；牌桌内刷新仍可恢复当前单人赛局。单人与多人牌桌共用桌面组件和视觉基线：底部显示本人名称与手牌数，且多人左右玩家的公开出牌会向牌桌中央留出间距。

## 本地运行多人游戏

在仓库根目录启动本地多人测试环境：

```powershell
npm.cmd run p4:dev
```

该脚本统一启动 Vite 前端（5173）与本地 Wrangler/Miniflare 权威后端（8788），并将两者日志镜像到当前终端。不要单独启动 Vite 或 Wrangler。正常结束时在同一终端按 `Ctrl+C`；如果终端被强制关闭、进程残留或端口需要清理，则从仓库根目录运行：

```powershell
npm.cmd run p4:stop
```

本机访问 `http://127.0.0.1:5173/`；局域网设备可访问 `http://<本机IP>:5173/`。`p4:dev` 与 `p4:stop` 仅用于本地开发／验收，正式部署由托管前端和 Cloudflare Worker 运行，无需在用户机器上执行这些命令。

## 文档入口

- [当前机器人策略说明](docs/基础机器人策略说明_V2.md)
- [已采用的掼蛋规则](<docs/掼蛋规则(被采用)_V1.md>)
- [统一规则口径](docs/resolved-rules.md)
- [架构基线](docs/architecture.md)
- [P2.7 发布记录](proj-info/phases/P2/release.md)
- [阶段入口](proj-info/phases/README.md)
- [策略收敛 ADR](proj-info/adr/ADR-0024-normal-vnext-strategy-replacement.md)
- [最新 P4 交接说明](proj-info/handoffs/HANDOFF-2026-07-30-P4-entry-exit-and-room-lifecycle.md)
- [座位、控制权与视图投影 ADR](proj-info/adr/ADR-0029-p3-seat-controller-and-view-projection.md)
- [项目开发合同](AGENTS.md)

## 目录

`docs/` 保存稳定规则和产品说明；`proj-info/` 保存计划、ADR、验收、发布与交接记录；`frontend/` 保存浏览器应用；`backend/` 保存 P3 Worker、Durable Object、实时协议与本地测试；`packages/guandan-core/` 是前后端共享的纯 TypeScript 规则核心；`tools/` 仅保存可复用工具；`temp/` 保存可删除中间产物且永不提交。
