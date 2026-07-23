# ADR-0028：P3 CSPRNG、受保护 seed 与受控回放

- 状态：accepted
- 日期：2026-07-23
- 决策者：产品负责人

## 决策

每局 shuffle seed 由服务端使用 Workers Web Crypto CSPRNG 生成，长度为 256 位。seed 仅在服务端权威状态中使用；客户端命令、个人投影、公开事件、响应、浏览器日志和指标均不得出现 seed。P3-02 将把现有可重放规则入口改为可接受服务端安全随机源的适配边界，不能继续让客户端 `Math.random()` 或序列化会话 seed 决定联机牌局。

每个房间在同一 SQLite 事务中追加命令幂等记录、规则事件和快照。seed 以 AES-GCM 加密后保存，密钥来自不提交的 Worker secret `ROOM_SEED_ENCRYPTION_KEY`；加密 blob、规则版本和快照版本是受保护的恢复材料。完成后的事件/快照/加密 seed 按 ADR-0025 的 30 天保留期清理。

受控回放只允许后端的恢复、审计与测试路径读取加密 seed 并重演；该能力没有浏览器端 API，运营诊断输出只包含 room/event 标识、版本和脱敏摘要。成功 ACK 必须对应可恢复的幂等命令与连续事件，因此 RPO=0；RTO≤15 分钟是 P3-10 的验收目标。

## 后果

- 生产密钥的创建、保管、轮换和部署必须经用户在 P3-12 明确授权后完成；届时先由用户完成 Cloudflare Free 账号与本机 `npx wrangler login` 浏览器授权。未经授权不得登录、部署、升级或购买；本仓库不提交密码、API Key、令牌、本地登录凭据或 `.env`。
- P3-04 必须测试重复命令、并发提交、重启、损坏快照和过期房间；P3-09 必须验证四个视角均不泄露 seed 或他人手牌。

## 一手资料

- [Cloudflare：Durable Object 生命周期和内存状态会丢失](https://developers.cloudflare.com/durable-objects/concepts/durable-object-lifecycle/)
- [Cloudflare：SQLite Durable Object 存储 API](https://developers.cloudflare.com/durable-objects/api/sqlite-storage-api/)
