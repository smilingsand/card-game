# ADR-0029：P3 逻辑座位、控制权与个人视角投影

- 状态：accepted
- 日期：2026-07-23
- 决策者：产品负责人

## 决策

掼蛋权威规则的逻辑座位固定为 `south → east → north → west → south`，与任何客户端的屏幕朝向无关。每个已入座的真人以 `(roomId, seat, controllerSubjectId)` 唯一绑定；Room 是唯一可建立、读取和恢复该绑定的服务端边界。重新连接仅重新取得同一匿名 subject 的既有 seat，不创建、转移或推断控制权。

客户端动作只可提供动作意图（`pass` 或 `play` 的实体 `cardIds`）、`clientCommandId` 和期望事件序号；`actor`、`seat`、首出者、完整状态和 seed 都不是客户端可信字段。Worker 先鉴权，Room 将 subject 映射为逻辑 seat，Authority 再补全 actor，并以权威当前回合、同一核心合法动作校验、连续序号和命令幂等记录执行。系统或测试的 synthetic owner 只能用于内部 fixture，绝不代表真人控制权。

第一局首出由服务端在创建牌局时规定或以服务端 CSPRNG 选择；客户端不能指定。后续局首出者继续完全采用共享核心已冻结的完局/贡牌规则。个人投影永远以逻辑座位生成：`bottom=self`、`left=upstream`、`right=downstream`、`top=teammate`；其中 `upstream` 为逻辑出牌顺序的前一席，`downstream` 为后一席。该映射只影响显示，不改变规则座位、事件 actor 或队伍关系。

## 后果

- Authority 的存档保存已冻结的 controller→seat 绑定摘要和首局 leader，恢复时不接收客户端重写。
- 非本回合、非控制者、伪造 actor、过期序号和重复命令必须得到稳定错误或原 ACK，不污染事件流。
- P3-06 建立这一内部适配；P3-07 只能消费个人投影并发送动作意图；P3-08 才处理断线后的机器人托管，不在本 ADR 改变控制权。
- P3-09 必须对四个逻辑座位验证手牌、seed 与隐藏评估不泄露。
