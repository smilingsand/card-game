# P7：normal-vNext 公开信息策略升级

状态：P7-00 `accepted`；P7-01 至 P7-05 尚未启动。

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
