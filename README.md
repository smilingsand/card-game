# 双副牌扑克游戏平台

可扩展的网页扑克游戏平台；当前可玩的产品是单人本地掼蛋（1 名人类南家 + 3 个机器人）。

## 当前版本

**P2.7 - normal-vNext 策略稳定化（Production，2026-07-23）**

- 唯一产品机器人和“提示”策略：普通 normal-vNext。
- normal-v1 仅作离线历史对照；P2.5 expert-24 已撤销为可恢复 Git 历史，详见 [ADR-0024](proj-info/adr/ADR-0024-normal-vnext-strategy-replacement.md)。
- normal-vNext 只消费 BotView 和规则层 `legalActions`，不读取隐藏手牌。
- 本地版本已包含：尾局下家阻断、合法动作兜底、自然中小结构争牌、控制资源保护，以及明牌时按出牌先后显示覆盖关系。
- P2.7 已部署到 Vercel Production 并完成用户人工试玩验收；正式入口为 `https://card-game-wentop.vercel.app/`。未来的移动端/PWA 风险变更按需单独复测。

下一项产品阶段任务为 P3-01。任务顺序和验收门槛以 [P1-P3 执行计划](proj-info/phases/P1-P3-execution-plan.md) 为准。

## 文档入口

- [当前机器人策略说明](docs/基础机器人策略说明_V2.md)
- [已采用的掼蛋规则](docs/掼蛋规则(被采用)_V1.md)
- [统一规则口径](docs/resolved-rules.md)
- [架构基线](docs/architecture.md)
- [P2.7 发布记录](proj-info/phases/P2/release.md)
- [阶段入口](proj-info/phases/README.md)
- [策略收敛 ADR](proj-info/adr/ADR-0024-normal-vnext-strategy-replacement.md)
- [最新交接说明](proj-info/handoffs/HANDOFF-2026-07-22-P2.7-normal-vnext-stabilization.md)
- [项目开发合同](AGENTS.md)

## 目录

`docs/` 保存稳定规则和产品说明；`proj-info/` 保存计划、ADR、验收、发布与交接记录；`frontend/` 保存浏览器应用；`backend/` 预留给 P3；`tools/` 仅保存可复用工具；`temp/` 保存可删除中间产物且永不提交。
