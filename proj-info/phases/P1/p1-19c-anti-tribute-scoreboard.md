# P1-19C：抗贡理由与记分牌活跃等级

状态：accepted（2026-07-15）

## 范围

- 结算提示在“本局抗贡，无需进贡”后显示公开的抗贡理由：按持有者聚合为“某家两个大王”或“某家一个大王，某家一个大王”。
- 牌桌左上角仅将本局级牌所属队伍的等级色块保持原色；另一方等级色块使用深灰色。

## 验收证据

- 固定牌例：西家持两个大王抗贡时，结算提示显示“西家两个大王”；本局级别所属方的记分色块不含 `inactive`，另一方包含 `inactive`。
- 定向：`npm.cmd run test:run -- src/App.test.tsx`，11 项通过。
- 全量：`npm.cmd run test:run`，19 个文件 / 96 项通过（含 1,000 局自动对局）。
- `npm.cmd run typecheck`、`npm.cmd run lint`、`npm.cmd run build` 均通过。
