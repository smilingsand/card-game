# ADR-0026：P3 实时协议与版本协商

- 状态：accepted
- 日期：2026-07-23
- 决策者：产品负责人

## 决策

采用浏览器原生 WebSocket 上的版本化 JSON 协议，首版协议为 `p3-ws-v1`。不采用 Socket.IO、SSE 或轮询：动作必须双向低延迟，且标准 WebSocket 已能满足四席房间；WebSocket 断线后必须由协议显式恢复，不能依赖传输层隐式重试。

连接首帧为 `hello`，包含支持的协议版本、匿名会话证明和最后已应用的 `eventSequence`。服务端选择最高共同版本；没有共同版本时返回明确的 `protocol.unsupported` 并关闭连接。客户端命令必须包含不可重复的 `clientCommandId` 和 `expectedEventSequence`；服务端校验身份、房间、座位和规则后，原子持久化并广播连续 `serverEvent`。`ack` 包含命令 ID 与已持久化的事件序号；拒绝则返回稳定错误码，不改变权威状态。客户端以序号请求 `resync`，只重放其个人视图与公开事件。

所有消息使用 `type`、`protocolVersion`、`roomId`、`payload` 的有界 schema。未知字段忽略前必须经版本定义允许；未知类型、超限尺寸或不兼容版本一律拒绝。P3-03 实现运行时 schema，P3-06 实现完整线序与重放测试。

## 后果

- ACK 只代表服务端已持久化，不代表其他客户端已经渲染。
- 客户端不能提交牌局状态、随机 seed、机器人决策或其他席位的手牌；只能提交命令。
- 协议破坏性变更必须增加版本，旧版本明确拒绝或按兼容窗口提供适配，不得静默重解释旧消息。

## 一手资料

- [Cloudflare：Durable Object WebSocket API](https://developers.cloudflare.com/durable-objects/api/state/)
- [Cloudflare：Workers 测试能力与 Durable Object 生命周期测试](https://developers.cloudflare.com/workers/testing/)
- [Railway：WebSocket 与 SSE 的双向传输比较](https://docs.railway.com/guides/sse-vs-websockets)
