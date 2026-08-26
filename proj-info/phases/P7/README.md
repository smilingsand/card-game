# P7：normal-vNext 公开信息策略升级

状态：P7-00 至 P7-04 `accepted`；P7-05 `ready_for_acceptance`（未发布）。

P7 在不改变 `guandan-v1` 规则、不恢复 P2.5 expert/master 路线的前提下，逐步吸收
协同、控牌、炸弹经济和残局路线评估的优点。产品策略仍只有 normal-vNext；normal-v1
仅可用于离线比较。

入口资料：

- [任务表](tasks.md)
- [测试矩阵](test-matrix.md)
- [发布记录](release.md)
- [P7 开发规划](../../plans/P7-newstrategydev/task_plan.md)
- [ADR-0035](../../adr/ADR-0035-p7-public-information-normal-vnext-strategy.md)

P7-00 已将模拟入口拆分为可导入的运行器和 CLI 薄封装。运行器接收依赖注入，因而可在
不运行真实牌局或写真实文件的情况下单测；CLI 只负责参数校验和调用。

P7-01 以纯公共动作投影生成 `StrategyObservation`：只包含已打出的牌面、公开座位/手数、
近期动作和赛局公共上下文；不存储或投影 seed、牌堆、未出牌或对手手牌。

P7-02 为 normal-vNext 的响应候选提供固定评分分项。策略只排序规则层合法动作，并公开
点数、结构破坏、控制资源、红桃级牌机会成本、卸载收益与公开残局拦截收益。

P7-05 新增 normal-vNext 专项固定 seed 决策基准，避免将 P7 策略门槛耦合到既有的
normal/basic 百局历史基准。2026-08-26 的本地复测中，5 个 seed 的首次决策均合法，最慢
决策未超过 5 秒；策略行为尚未进入 Preview 或 Production。
