# P2.5 发布记录

> 已撤销（2026-07-22）：不再发布 P2.5 expert 策略；原记录仅供历史追溯。

状态：未开始。仅在 P2.5A 的 P2.5-17 完成全部门禁、Preview 验收与 Production 验证后填写；P2.5B/C 使用各自 profile/version 追加独立发布记录。

## 发布前必填

- 发布 commit：待定
- Preview URL：待定
- Production deployment：待定
- 回滚目标：待定
- 规则版本与存档 schema：必须记录，并确认 P2.5 未改变其语义。
- 策略规则集版本、权重版本、固定牌例批次（A: S01—S50；B/C: S51—S100）与对测种子范围：待定
- 默认 `expert`、回归 `normal`、实验 `experimental` profile 版本和启停差异：待定
- `needs_expert_validation` 默认资格门禁审计与 experimental 隔离结果：待定
- 三档性能样本、平均/P95、冷暖缓存口径与是否启用 Web Worker：待定

## 验收记录

- 待 P2.5-17 填写：格式、类型、lint、固定牌例、信息边界、10,000 局模拟、9 项错误指标、头游/双上、平均/P95、缓存/剪枝等价性、机器人/提示 expert 一致性、normal 回归对照、experimental 隔离、浏览器调试开关与发布验证的实际命令/结果。
