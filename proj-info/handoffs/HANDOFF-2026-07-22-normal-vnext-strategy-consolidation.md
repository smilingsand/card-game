# 2026-07-22 策略收敛交接

## 已完成

- P2.5 expert-24 链路与 Preview UI 已显式撤销，原提交仍可恢复。
- normal-vNext 已从研究分支合并为唯一产品机器人策略。
- 牌桌机器人和提示只接收 BotView 与规则层完整 legalActions；没有读取隐藏手牌。
- normal-vNext 的 A/B/C1-C3 固定测试、离线诊断与 Preview 诊断代码随合并保留。

## 后续

- 需要人工试玩 normal-vNext，重点观察接牌成本、队友持权、三带二附带对子和尾局阻断。
- 任何新策略缺陷应建立 normal-vNext 后续任务；不得直接恢复 P2.5 expert 链路。
