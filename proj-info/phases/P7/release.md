# P7 发布记录

尚未发布。

P7-00 仅建立策略治理和离线基线运行器，不改变 normal-vNext 决策、规则、UI、存档或网络协议，
因此不需要 Preview 或 Production 验收。任何 P7 策略行为变更均须在 P7-05 完成新的
Preview 与 Production 验收后才可发布。

## 2026-08-26：P7-05 本地收敛证据

- 固定 seed `0, 1, 7, 42, 99` 的 normal-vNext 首次决策基准通过；每个动作均来自规则层合法动作集，最慢单次决策低于 5 秒。
- 此记录不是发布：未创建 Preview、未合并 `main`、未执行 Production 验收，线上仍维持原已发布版本。
- 回滚目标：若后续 Preview 或 Production 验证发现策略回归，回退 P7 系列提交至 `3507d7c` 的 P7-00 基线策略版本。
