# ADR-0025：P3 权威运行时、持久化与部署边界

- 状态：accepted
- 日期：2026-07-23
- 决策者：产品负责人

## 背景

P3 每个房间最多四名真人，须维护长连接、严格的单房间动作顺序、断线恢复与可持久化的权威状态。前端继续由 Vercel 托管；所有服务端可执行代码必须在 `backend/`。选择不能让客户端成为裁决者，且本地开发和自动化验证不能依赖云资源。

## 备选与结论

| 方案                                                         | 优点                                                                                                         | 不采用原因 / 风险                                                                           |
| ------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------- |
| Cloudflare Workers + 每房间一个 SQLite-backed Durable Object | Durable Object 是单线程、全局唯一协调单元；含私有强一致存储和可休眠 WebSocket；Wrangler/Miniflare 可本地模拟 | 绑定 Cloudflare 运行时；需避免把状态只放内存                                                |
| Railway 常驻 Node + Socket.IO + 外部 Postgres/Redis          | 常规 Node 生态，Socket.IO 有回退与重连                                                                       | 多实例需另行保证房间串行与共享状态；官方指南说明 WebSocket 有 15 分钟连接限制，基础设施更多 |
| Render 常驻 Node + Postgres/Redis                            | 原生支持 WebSocket 和托管 Postgres                                                                           | 负载均衡不会保证重连回同一实例；持久磁盘不能横向扩容且会失去零停机部署，仍需额外协调层      |

采用 Cloudflare Workers + SQLite-backed Durable Objects：一个 `roomId` 映射一个 Durable Object，一个房间的所有命令、事件追加、快照和投影均在该对象内串行执行。浏览器通过标准 WebSocket 接到对象；HTTP Worker 仅处理握手、鉴权和路由。Cloudflare 只承载后端，绝不替代 Vercel 前端或 PWA。

## 环境与授权边界

```text
本地开发 / POC / 自动测试 / 浏览器联调
Vite（本地前端） -> Wrangler Worker（本地） -> SQLite-backed Durable Object（本地）

公网 Preview / Production
Vercel Hobby（前端 / PWA） -> WebSocket Hibernation -> Cloudflare Worker + SQLite-backed Durable Object
```

- 本地链路不部署 Cloudflare、不需要 Cloudflare 账号、不创建云资源、不产生 Cloudflare 费用。P3-01 的 Miniflare POC 是该本地运行时的可删除验证；P3-03 才创建正式的 `backend/` Wrangler 工程。
- Workers Free 用于当前开发、测试和早期公网 MVP；本阶段禁止购买或升级 Workers Paid。
- P3-12 的公网部署验收前必须暂停，等待用户自行注册 Cloudflare Free 账号，并在其本机执行 `npx wrangler login` 的浏览器授权。未经用户在当时明确批准，不得登录、创建云资源、部署、升级计划或产生付费。
- 密码、API Key、token、Cookie、本地 Wrangler 登录凭据、`.env` 和任何真实用户数据均禁止提交，也不得写入日志、测试快照或回复。

## 持久化、容量与退出

- 每个房间使用 SQLite-backed Durable Object 私有存储；禁止把权威状态仅保存在类字段或 WebSocket attachment。
- 成功 ACK 的必要条件是同一事务内写入幂等命令记录、连续事件与所需快照；目标 RPO 为 0。目标 RTO 为 15 分钟，P3-10 必须实测恢复演练。
- 活跃房间闲置 24 小时过期；已结束房间事件、快照和加密 seed 保留 30 天后删除。该保留期仅用于恢复、审计和测试。
- 受控导出采用版本化 JSONL（room 元数据、事件、快照、加密 seed），用于迁出 Cloudflare 或离线诊断；导出不含会话令牌，且绝不向客户端发送 seed。
- Workers Free 的具体配额、连接规模与性能以部署当日官方文档和 P3-10/P3-12 实测为准；不得以本地 POC 时延推断线上容量或费用。

## 后果

- `backend/` 将使用 Workers/DO 兼容 TypeScript，而非常驻 Express 服务；P3-02 先抽取与 Worker、React、DOM 均无关的共享规则核心。
- Durable Object 可能休眠或重启，P3-04 必须从存储重建状态；P3-06 客户端必须支持重连和事件缺口恢复。
- P3-12 如发现 Workers Free 不满足已冻结验收目标，必须停止并向用户报告，不得自行升级为 Paid。

## 一手资料

- [Cloudflare：Durable Object 的单线程唯一实例与持久存储规则](https://developers.cloudflare.com/durable-objects/best-practices/rules-of-durable-objects/)
- [Cloudflare：休眠 WebSocket 与重建要求](https://developers.cloudflare.com/durable-objects/best-practices/websockets/)
- [Cloudflare：SQLite-backed Durable Object 存储和 PITR](https://developers.cloudflare.com/durable-objects/best-practices/access-durable-objects-storage/)
- [Cloudflare：Workers 价格和 Free 计划](https://developers.cloudflare.com/workers/platform/pricing/)
- [Railway：WebSocket/Socket.IO 部署限制](https://docs.railway.com/guides/socketio)
- [Render：WebSocket 连接与重连行为](https://render.com/docs/websocket)
- [Render：持久磁盘限制](https://render.com/docs/disks)
