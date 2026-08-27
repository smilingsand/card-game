# P3 任务状态

| ID    | 状态                 | 本任务证据                                                                                                                 |
| ----- | -------------------- | -------------------------------------------------------------------------------------------------------------------------- |
| P3-01 | accepted             | ADR-0025 至 ADR-0028；`backend/poc/` 四客户端 Durable Object 与名称策略 POC；本目录测试矩阵                                |
| P3-02 | accepted             | `packages/guandan-core/` 唯一源码、workspace package export、浏览器/Node 固定 seed 回放均已验收                            |
| P3-03 | accepted             | 本地 Worker + SQLite DO 安全基线、官方类型和本地黑盒测试已验收                                                             |
| P3-04 | accepted             | 256 位 seed 生命周期、权威 DO、幂等/恢复/快照/TTL 与本地黑盒已验收；以 [总计划](../P1-P3-execution-plan.md) 为准           |
| P3-05 | accepted             | 房间、座位、准备、受控开始和 1–4 真人/机器人矩阵已完成主验收；未部署。                                                     |
| P3-06 | accepted             | Hibernation WebSocket、座位控制权、可靠 ACK/重放与个人投影同步已完成主验收；以 [总计划](../P1-P3-execution-plan.md) 为准   |
| P3-07 | accepted             | 多人大厅、个人投影和单人存档隔离已验收；后续首页/退出等本地体验调整属于 P4 补充记录，未改变 P3-07 验收结论。               |
| P3-08 | accepted             | ADR-0030 已冻结；主 agent 综合验收已通过：P3-08、P3-03、P3-05、P3-06、前后端 typecheck、前端 lint/build、diff 检查均通过。 |
| P3-09 | accepted             | 四视角泄露、会话固定/重放、权限矩阵和既有边界下的滥用防护回归已由主 agent 验收通过。                                       |
| P3-10 | accepted             | ADR-0031；本地受控备份/校验/恢复演练、脱敏结构化审计与 P3-10 黑盒测试已完成，等待主 agent 综合验收。                       |
| P3-11 | ready_for_acceptance | 自动矩阵及多人牌桌控制/理牌修复已验证；等待按本地人工验收手册完成四客户端证据后才可 accepted，未部署。                     |
| P3-12 | not_started          | 以 [总计划](../P1-P3-execution-plan.md) 为准                                                                               |

P3-01 至 P3-10 均已由主 agent 验收；P3-11 已完成自动矩阵，等待本地浏览器人工验收。P3-12 的公网部署尚未启动。
