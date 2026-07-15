# 双副牌扑克游戏平台

一个可扩展的网页扑克游戏平台。首个游戏是单人本地掼蛋，后续将增加移动/PWA、多人掼蛋与拖拉机 80 分。

## 当前状态

P1 已完成；P2 已交付响应式牌桌、PWA 离线静态壳和普通难度策略机器人。当前 Production 项目为 `wentop/card-game`，公网入口为 <https://card-game-wentop.vercel.app>；访问状态、部署与回滚信息见 [P2 发布记录](proj-info/phases/P2/release.md)。

P2-01 至 P2-05 已验收。P2-06 的 Preview/Production 发布、Chrome 离线/更新复核和移动视口检查已完成；iPhone Safari 的“添加到主屏幕后离线启动”仍待最终人工复测，故 P2-06 保持 `ready_for_acceptance`。任务顺序与验收证据见 [P2 阶段记录](proj-info/phases/P2/README.md) 和 [P1-P3 执行计划](proj-info/phases/P1-P3-execution-plan.md)。下一开发阶段为 P3。

## 文档入口

- [已采用的掼蛋规则](docs/掼蛋规则(被采用)_V1.md)
- [基础机器人策略](docs/基础机器人策略说明_V1.md)
- [统一掼蛋规则口径](docs/resolved-rules.md)
- [架构基线](docs/architecture.md)
- [P1 完结交接记录](proj-info/phases/P1/phase-1-closeout.md)
- [P2 阶段记录](proj-info/phases/P2/README.md)
- [P2 验收矩阵](proj-info/phases/P2/test-matrix.md)
- [平台路线图](proj-info/00-平台规划与会话记忆/platform-roadmap.md)
- [跨会话记忆规范](proj-info/00-平台规划与会话记忆/session-memory-playbook.md)
- [项目级开发规范](AGENTS.md)

## 目录

`docs/` 保存规则和使用说明；`proj-info/` 保存计划、ADR、验收与发布记录；`frontend/` 和 `backend/` 分别在 P1/P3 创建；`tools/` 仅存可复用工具；`temp/` 存可删除临时文件且不提交。
