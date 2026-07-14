# 双副牌扑克游戏平台

一个可扩展的网页扑克游戏平台。首个游戏是单人本地掼蛋，后续将增加移动/PWA、多人掼蛋与拖拉机 80 分。

## 当前状态

第一阶段 P1 已完成：浏览器内可运行 1 名人类（南家）与 3 个基础机器人的本地掼蛋，支持确定性规则、手动理牌、提示、明牌测试、连续多局、等级、进贡/还贡/抗贡，以及版本化 IndexedDB 存档。当前 Production 项目为 `wentop/card-game`；访问状态与回滚信息见 [P1 发布记录](proj-info/phases/P1/release.md)。

下一阶段从 P2-01（响应式牌桌与触摸选牌）开始。任务顺序与验收条件见 [P1-P3 执行计划](proj-info/phases/P1-P3-execution-plan.md)。

## 文档入口

- [已采用的掼蛋规则](docs/掼蛋规则(被采用)_V1.md)
- [基础机器人策略](docs/基础机器人策略说明_V1.md)
- [统一掼蛋规则口径](docs/resolved-rules.md)
- [架构基线](docs/architecture.md)
- [P1 完结交接记录](proj-info/phases/P1/phase-1-closeout.md)
- [平台路线图](proj-info/00-平台规划与会话记忆/platform-roadmap.md)
- [跨会话记忆规范](proj-info/00-平台规划与会话记忆/session-memory-playbook.md)
- [项目级开发规范](AGENTS.md)

## 目录

`docs/` 保存规则和使用说明；`proj-info/` 保存计划、ADR、验收与发布记录；`frontend/` 和 `backend/` 分别在 P1/P3 创建；`tools/` 仅存可复用工具；`temp/` 存可删除临时文件且不提交。
