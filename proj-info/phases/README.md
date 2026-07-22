# 阶段执行记录

## 当前入口

| 目录/文件 | 状态 | 用途 |
| --- | --- | --- |
| [P1](P1/README.md) | 历史完成 | 单人本地掼蛋 MVP 的任务、测试、发布与收口证据。 |
| [P2](P2/README.md) | 已完成；P2.7 Production 已人工验收 | 移动/PWA、normal-vNext 产品策略和发布记录。 |
| [P2.5](P2.5/tasks.md) | 历史归档，已撤销 | expert-24 路线的可恢复 Git 历史；不是执行入口。 |
| P3 | 尚未开始 | P3-01 启动时创建目录。 |
| [P1-P3 执行计划](P1-P3-execution-plan.md) | 当前总表 | 唯一的跨阶段依赖、状态和验收门槛来源。 |

## 当前产品与版本

- 当前唯一产品策略为 normal-vNext；normal-v1 仅作离线历史对照。
- P2.7 - normal-vNext 策略稳定化已在本地和 GitHub 版本化，并于 2026-07-23 部署到 Vercel Production；正式入口为 `https://card-game-wentop.vercel.app/`，用户已完成试玩并确认验收。
- 下一可启动任务仍是 P3-01；P2.7 不改变 P3 依赖。

## 维护规则

- 新任务只从总表中依赖已满足、状态为 `not_started` 的条目启动。
- 每个活动阶段至少维护 README、tasks、test-matrix 和 release。
- 历史阶段不重写原始证据；后续结论写入当前发布记录、ADR 或交接说明。
- P2.5 恢复必须先新增 ADR、重新评审并完成人工 Preview 验收。
