# ADR-0028：P3 CSPRNG、受保护 seed 与受控回放

- 状态：accepted
- 日期：2026-07-23
- 决策者：产品负责人

## 决策

每局 shuffle seed 由服务端使用 Workers Web Crypto CSPRNG 生成，固定为 32 bytes，并以 64 个小写十六进制字符保存和传递给共享核心。`packages/guandan-core` 以独立、同步、跨环境的 256 位确定性 PRNG 消费全部四个 64 位 seed word；不得截断、哈希或降级为 32 位 seed。现有 `number` seed 与 Mulberry32 路径仅保留给 P1/P2 历史存档与固定牌例，其回放结果不得改变；P3 权威牌局一律经新的 256 位入口创建。seed 仅在服务端权威状态中使用；客户端命令、个人投影、公开事件、响应、浏览器日志和指标均不得出现 seed，也不得以客户端 `Math.random()` 或序列化会话 seed 决定联机牌局。

每个房间在同一 SQLite 事务中追加命令幂等记录、规则事件和快照。seed 以 AES-GCM 加密后保存，密钥来自不提交的 Worker secret `ROOM_SEED_ENCRYPTION_KEY`；加密 blob、规则版本和快照版本是受保护的恢复材料。完成后的事件/快照/加密 seed 按 ADR-0025 的 30 天保留期清理。

受控回放只允许后端的恢复、审计与测试路径读取加密 seed 并重演；该能力没有浏览器端 API，运营诊断输出只包含 room/event 标识、版本和脱敏摘要。成功 ACK 必须对应可恢复的幂等命令与连续事件，因此 RPO=0；RTO≤15 分钟是 P3-10 的验收目标。

P3-04 只提供由已鉴权 Worker 转发到 Durable Object 的内部权威牌局接口：初始化、持久化、动作校验/应用、个人投影和受控恢复。它不定义公开房间、邀请码、座位、房主或真人/机器人编排；这些生命周期与权限映射仍完全属于 P3-05。任何后续公开入口都必须先完成 P3-03 鉴权，再由 P3-05 的房间权限映射决定可控制的座位。

## seed 生命周期

- 每次创建新比赛、重新开赛或开始下一局，权威服务端均以 Workers Web Crypto CSPRNG 新生成一个独立的 256 位 seed；不得递增、复用上一局或接受客户端指定的 seed。
- 旧 `number` seed 与 `deriveSecureSeed` 仅保留给本地历史存档和既有确定性测试。P3 权威会话开始下一局时必须显式把 Worker 新生成的 secure seed 传入共享核心；该 seed 作为加密的后端事件材料持久化，并在受控重放时重新注入，不能由根 seed 派生。
- 仅恢复同一局、审计同一局或受控重放同一局可以读取并复用原 seed。重新开赛必须创建新的 `gameId` 和新的 seed，并原子清除旧命令、事件与快照。
- 服务端持久化 `gameId`、加密 seed、规则版本、事件流和快照；公共响应、日志、个人投影与客户端命令均不得包含 seed。测试只可经未由公开 Worker 路由暴露的本地内部夹具核验 seed 指纹和长度。

## 后果

- 生产密钥的创建、保管、轮换和部署必须经用户在 P3-12 明确授权后完成；届时先由用户完成 Cloudflare Free 账号与本机 `npx wrangler login` 浏览器授权。未经授权不得登录、部署、升级或购买；本仓库不提交密码、API Key、令牌、本地登录凭据或 `.env`。
- P3-04 必须测试重复命令、并发提交、重启、损坏快照和过期房间；P3-09 必须验证四个视角均不泄露 seed 或他人手牌。

## 一手资料

- [Cloudflare：Durable Object 生命周期和内存状态会丢失](https://developers.cloudflare.com/durable-objects/concepts/durable-object-lifecycle/)
- [Cloudflare：SQLite Durable Object 存储 API](https://developers.cloudflare.com/durable-objects/api/sqlite-storage-api/)
