# P2：移动/PWA 与策略机器人

状态：P2-01 至 P2-06 已 `accepted`。P2.7 是 P2 完成后的本地策略稳定化版本，不创建新的 P2 子任务，也不改变 P3 依赖。

## P2.7 - normal-vNext 策略稳定化

日期：2026-07-22。产品唯一机器人为 normal-vNext；normal-v1 仅保留离线对照，P2.5 expert-24 为已撤销历史。

本地版本包含：

- 下家 1～6 张的尾局威胁与 1～3 张强制阻断；
- 合法动作兜底，避免策略层造成“无可执行动作”；
- 自然中小对子、三张、三带二的开中局争牌收益；
- A、级牌、红桃级牌、大小王的递增控制资源保护；
- 明牌时后出牌覆盖先出牌的桌面层级；
- 只读 BotView、完整规则层 legalActions 与统一规则校验。

本地回归与 Production 人工试玩已通过；P2.7 已于 2026-07-23 部署到 Vercel Production，正式入口为 `https://card-game-wentop.vercel.app/`。本版已收口；详情见 `tasks.md`、`test-matrix.md` 和 `release.md`。
