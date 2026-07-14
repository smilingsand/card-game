# P1-19A：进贡先手与级牌来源修正

状态：accepted（2026-07-14）

## 已确认口径

- 单下：进贡者先出。
- 双下：较大贡牌者先出；贡牌同点时按项目冻结口径由头游下家先出；抗贡时头游先出。
- 本局级牌独立取上一局头游方结算升级后的等级，不随下一局先手改变。

## 实现与证据

- 会话规则升级为 `guandan-v4` / schema 4，旧 `guandan-v3` 存档明确拒绝恢复。
- 固定牌例覆盖：北家头游、东家进贡、我方由 6 升至 8 时，下一局东家先出、级牌为 8。
- `npm.cmd run typecheck`、`npm.cmd run lint`、定向 17 项测试、全量 `npm.cmd run test:run -- --configLoader runner`（19 files / 93 tests）和临时目录生产构建均通过。
