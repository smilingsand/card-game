# P7 策略升级：调研结论

## 用户要求

- 吸收 `dengweiqh/guandan-windows` 可取的策略优点，优化本项目出牌策略。
- 不恢复原 P2.5 expert/master 路线。
- 先规划、后开发；工作保存在 `P7-newstrategydev` 分支。

## 上游实现结论

- 上游的四个 `ai-strategy-*.ts` 主要是参数档位；实际策略集中在 `src/lib/ai.ts` 及三个 override 文件。
- 可借鉴：队友让牌/临门配合、低剩余张数阻断、炸弹机会成本、复合牌优先、己方手牌路线评估、公开出牌计数。
- 不可复用：上游 hard/master 会读取 `players[nextPlayerId].hand` 生成对手回应；`ai.ts` 多处使用随机数、时间截止、模块级可变记忆，并重复实现合法出牌枚举和规则。
- 上游 README 描述的“概率估计”和“对手建模”主要体现为已出牌计数、最近出牌模式和固定阈值，不能视为已经验证的概率模型。

## 本项目基础

- `packages/guandan-core/src/games/guandan/bot-view.ts`：已提供己方手牌、公开事件、剩余张数和合法动作。
- `normal-vnext-bot.ts`：已有结构破坏成本、控制牌/逢人配成本、队友让牌和下家残局阻断。
- `simulation.ts`：已有固定 seed 自动对局、合法性校验与 BotView 诊断接口。
- `bot-benchmark.ts`、`bot-benchmark.test.ts` 与 10k 分批基准已存在，可作为 P7-00 的固定 seed 对局和计时基线入口；P7 不应另建第二套规则模拟器。
- 缺口：公开事件中需要可供策略记牌的公开牌面表示；赛局上下文未作为策略只读输入规范化；当前尚无统一 observation/评分分项/基准协议。

## P7-00 实施发现

- 已接受的 ADR-0014 已冻结“BotView + 公开比较键”的 P2 观察模型；P7-01 只能在新增 ADR 下扩展为公开牌面统计，不能绕过该信息边界。
- 已接受的 ADR-0024 已规定 normal-vNext 是唯一产品策略且 expert-24 已撤销；P7-00 必须引用并保持该决定。
- P3-07/P3-11 仍处于 `ready_for_acceptance`；P7-00 不改变其代码或验收状态，只在 P7 测试矩阵中要求后续策略改动回归其个人投影边界。
- 基线命令根因：`vite-node` 未使用 `--script`，所以后续 `--profile`、`--seeds` 等参数未可靠转发到模拟脚本。官方 README 规定 `--script` 会把全部后续选项转给脚本。
- 直接以 `--script` 试跑时，Vite 需要在 `frontend/node_modules/.vite-temp` 写入临时配置，受当前沙箱限制报 `EPERM`；需在受控权限下验证，不能据此归因于项目缺陷。
- 基线入口已拆分为 `normal-vnext-simulation-runner.ts` 与 CLI 薄封装。运行器显式注入时钟、模拟、诊断与文件系统依赖，单测可在无真实牌局和无真实写盘的情况下覆盖成功、失败与报告行为。
- `vite-node --script` 修复后，固定 seed 0 可稳定生成报告；五 seed 聚合在当前受控执行环境仍会在报告写出前结束。P7-00 只记录单 seed 可重放基线，不把该环境问题误写成五 seed 已通过。

## P7-06 接入发现

- `chooseNormalVNextBotAction` 当前实际消费了 P7-02 的候选评分与 `analyzeCooperationSignal`，但 `describeNormalVNextBombEconomics` 和 `estimateNormalVNextSelfRoute` 只被固定牌例调用。
- `createStrategyObservation` 已可由 `BotView.publicActions` 纯函数重建，但当前选择器没有把它用于任何候选分项。
- 接入必须保持所有候选来自 `view.legalActions`；公开牌统计只可降低或提高公开控制资源风险，不能推断具体对手手牌。

## 约束来源

- `AGENTS.md`：规则和 BotView 必须位于 `packages/guandan-core`；机器人不得获得对手手牌；P2.5 expert 路线已撤销，恢复须 ADR。
- `docs/resolved-rules.md`：产品规则为 `guandan-v5`；A 失败回退等地区附加规则默认不实现。
- `README.md`：实际产品策略只有 `normal-vNext`，并明确需要公开信息、固定牌例、确定性和合法动作约束。

## 资源

- 上游仓库：https://github.com/dengweiqh/guandan-windows
- 上游本地目录：`D:\MyWorks\guandan-windows\src\lib\`
- 本项目策略核心：`packages/guandan-core/src/games/guandan/`
