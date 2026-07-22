# 双副牌扑克游戏平台

一个可扩展的网页扑克游戏平台。首个游戏是单人本地掼蛋，后续将增加移动/PWA、多人掼蛋与拖拉机 80 分。

## 当前状态

P1、P2 已完成。当前本地 `main` 使用 normal-vNext 作为唯一产品机器人策略；机器人和提示只消费 BotView 与规则层提供的合法动作。P2.5 expert-24 路线已撤销并作为可恢复历史归档，详见 [ADR-0024](proj-info/adr/ADR-0024-normal-vnext-strategy-replacement.md)。

P2-01 至 P2-06 均已验收，包含 PWA、Production 与 iPhone Safari 离线复测。当前线上部署记录仍对应 P2-06；normal-vNext 收敛后的下一次发布须重新完成 Preview/Production 验收。任务顺序与验收证据见 [阶段入口](proj-info/phases/README.md) 和 [P1-P3 执行计划](proj-info/phases/P1-P3-execution-plan.md)。下一可启动产品阶段为 P3。

## 文档入口

- [已采用的掼蛋规则](docs/掼蛋规则(被采用)_V1.md)
- [当前机器人策略说明](docs/基础机器人策略说明_V2.md)
- [统一掼蛋规则口径](docs/resolved-rules.md)
- [架构基线](docs/architecture.md)
- [P1 完结交接记录](proj-info/phases/P1/phase-1-closeout.md)
- [P2 阶段记录](proj-info/phases/P2/README.md)
- [P2 验收矩阵](proj-info/phases/P2/test-matrix.md)
- [策略收敛 ADR](proj-info/adr/ADR-0024-normal-vnext-strategy-replacement.md)
- [阶段文档入口](proj-info/phases/README.md)
- [平台路线图](proj-info/00-长期路线图与历史工作日志/platform-roadmap.md)
- [新 session 读取规范](proj-info/00-长期路线图与历史工作日志/session-memory-playbook.md)
- [项目级开发规范](AGENTS.md)

## 目录

`docs/` 保存规则和使用说明；`proj-info/` 保存计划、ADR、验收与发布记录；`frontend/` 保存浏览器应用；`backend/` 预留给 P3；`tools/` 仅存可复用工具；`temp/` 存可删除临时文件且不提交。
