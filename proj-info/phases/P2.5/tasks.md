# P2.5 撤销记录

状态：**revoked / superseded（2026-07-22）**。

用户完成三种机器人策略的人工试玩后，决定不再把 P2.5 的 expert-24
链路作为产品策略。P2.5-01 至 P2.5-16（以及未启动的后续 P2.5 任务）已在
`codex/normal-vnext-main-integration` 上按提交顺序显式 revert；游戏牌桌仅保留
normal-vNext。

## 保留与边界

- P2.5 的原始 Git 提交没有删除，因此日后仍可通过 revert 这些 revert 提交或从
  历史分支挑选提交来恢复；恢复前必须重新进行架构评审和人工验收。
- 仅保留 normal-vNext 必需的、规则层完整合法动作枚举。它不含 HandPlan、
  ExpertStrategyKnowledgeBase、ActionScorer、FollowUpPlanner 或 expert UI。
- normal-v1 仅作为历史基线和离线诊断对照，不再由游戏界面或默认机器人入口调用。
- 不得恢复 P2.5 的 Preview UI、expert profile 或深度策略链路，除非先创建新的 ADR
  和独立任务计划。

后续机器人改进从 normal-vNext 的独立任务开始，不再以 P2.5 编号继续。
