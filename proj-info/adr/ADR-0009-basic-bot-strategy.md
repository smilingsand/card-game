# ADR-0009：初级机器人策略与 tie-break

- 状态：已接受
- 日期：2026-07-13

## 决策

初级机器人只消费 BotView 的合法动作。由 selfSeat 与 highestSeat 推导对家；对家领出且 pass 合法时优先 pass。评分优先级为较小 comparisonKey、不拆自身手牌中的对子/三张（出掉组合的部分时施加罚分）、尾盘任一家公开剩余牌数降至 1 张时优先以合法出牌拦截。完全同分时按动作类型、牌 ID 字典序稳定选择。单次选择预算 10ms。

## 后果

不读取对手手牌、seed 或 TurnState；输出始终为 BotView.legalActions 的一个元素。
