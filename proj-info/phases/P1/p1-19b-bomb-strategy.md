# P1-19B：基础机器人炸弹使用策略

状态：accepted（2026-07-14）

## 范围

- 炸弹可继续由规则引擎压制任何非炸弹牌型；本任务只调整机器人和“提示”的候选及选择策略。
- 机器人在尚有普通牌时不领出炸弹；仅余炸弹时允许领出。
- 跟牌时完整枚举四张及以上的同点数炸弹；若手持五张及以上炸弹，则按完整张数出牌，不拆成四张。
- 保留顺子等牌型在确有需要时使用炸弹牌的现有规则引擎能力。

## 验收证据

- 固定牌例：首轮手持普通牌时不领出炸弹；四张炸弹可压普通对子；五张 `8` 炸压四张 `6` 炸时完整出五张。
- 定向：`npm.cmd run test:run -- src/games/guandan/table-controller.test.ts src/games/guandan/basic-bot.test.ts`，20 项通过。
- 全量：`npm.cmd run test:run`，19 个文件 / 95 项通过（含 1,000 局自动对局）。
- `npm.cmd run typecheck`、`npm.cmd run lint`、`npm.cmd run build` 均通过。
