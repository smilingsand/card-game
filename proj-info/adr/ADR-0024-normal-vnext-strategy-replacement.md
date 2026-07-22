# ADR-0024：以 normal-vNext 替代 P2.5 expert Preview

- 日期：2026-07-22
- 状态：accepted

## 背景

人工试玩确认 normal-vNext 虽仍有可改进处，但整体平衡性优于 normal-v1，且比
expert-24 Preview 更适合当前产品。产品不再同时展示多个机器人策略。

## 决策

1. 游戏牌桌、机器人和提示的唯一产品策略为 normal-vNext。
2. normal-v1 不再在 UI 或默认入口使用；仅保留为历史基线及离线诊断对照。
3. P2.5-01 至 P2.5-16 与 expert-24 Preview 按提交顺序显式 Git revert，而不是
   重写历史或删除提交。
4. 为 normal-vNext 保留完整合法动作枚举这一纯规则候选工具；它只生成经规则层
   验证的动作，不包含 P2.5 expert 的深度评分、规划或隐藏信息。

## 后果与回滚

- 新局面的策略行为统一为 normal-vNext，UI 不再提供 profile 切换。
- 原 P2.5 提交和 revert 提交均保留在历史中。若未来恢复，先创建新 ADR，再对指定
  revert 提交执行显式 revert 或从历史分支选择性恢复，并重新验收。
- 当前不恢复 P2.5-16 性能门禁，也不把 normal-v1 或 expert 重新设为默认。
