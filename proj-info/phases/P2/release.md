# P2 发布记录

## P2.7 - normal-vNext 策略稳定化（Production）

- 日期：2026-07-23
- 本地 Git 标签：`P2.7-local`（指向本次文档与版本提交）
- npm 包版本：`2.7.0`
- 范围：normal-vNext 尾局阻断、合法动作兜底、中小自然结构争牌、控制资源保护、明牌出牌叠层。
- 本地验证：`typecheck`、`lint`、normal-vNext 41 项、策略指标 1 项、table-controller 11 项、App 19 项通过。
- 源代码提交：`7ef2dbf`（`P2.7: document normal-vNext stabilization`）。
- Vercel Production：`dpl_EdpHsAKzhmCUyjHUTPuHBXJjxnYQ`，2026-07-23 由 `wentop/card-game` 远端构建完成；构建执行 `npm run build`、TypeScript 检查和 Vite 构建均通过。
- 部署详情：[Vercel Inspect](https://vercel.com/wentop/card-game/EdpHsAKzhmCUyjHUTPuHBXJjxnYQ)；不可变部署地址：`https://card-game-r30w56pj1-wentop.vercel.app`。
- 正式入口：`https://card-game-wentop.vercel.app/`，已重新绑定到上述部署，并以匿名 HTTPS 请求确认 HTTP 200 与应用根节点存在。
- 人工验收：2026-07-23，用户已在正式入口完成试玩并明确确认验收；本版在此收口。
- 发布状态：**Production 已完成、公开可访问且人工验收通过。** 未单独创建 P2.7 Preview；未来如产生移动端/PWA 风险变更，仍须补充相应人工证据，不得以 P2-06 的历史真机证据替代新变更的验收。

## P2-06 历史 Production 记录

P2-06 于 2026-07-16 验收，Production 为 `dpl_6i79U85p4bAstRwUowj3guxaETAf`，规则版本 `guandan-v5`。该记录只证明 P2-06，不证明 P2.7；历史 URL 与真机证据保留在 Git 历史和阶段执行计划中。
