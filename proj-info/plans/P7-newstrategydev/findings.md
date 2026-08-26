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
- 缺口：公开事件中需要可供策略记牌的公开牌面表示；赛局上下文未作为策略只读输入规范化；当前尚无统一 observation/评分分项/基准协议。

## 约束来源

- `AGENTS.md`：规则和 BotView 必须位于 `packages/guandan-core`；机器人不得获得对手手牌；P2.5 expert 路线已撤销，恢复须 ADR。
- `docs/resolved-rules.md`：产品规则为 `guandan-v5`；A 失败回退等地区附加规则默认不实现。
- `README.md`：实际产品策略只有 `normal-vNext`，并明确需要公开信息、固定牌例、确定性和合法动作约束。

## 资源

- 上游仓库：https://github.com/dengweiqh/guandan-windows
- 上游本地目录：`D:\MyWorks\guandan-windows\src\lib\`
- 本项目策略核心：`packages/guandan-core/src/games/guandan/`
