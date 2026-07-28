# P4-02 当前墩公开动作投影

## 范围

修正多人个人投影和共享牌桌对“当前一墩”的公开信息展示；不改变
掼蛋规则、机器人策略、房间、WebSocket 或 Durable Object 调度。

## 合同

- `leader` 是本墩第一个实际出牌的逻辑座位；它不同于 `highestPlay.actor`。
- Authority 使用核心的 `latestRecentActionsBySeat(publicEvents)` 取得当前墩每个
  座位最后一次公开动作。三次连续过牌结束一墩后，该核心函数自然返回空集合。
- Authority 仅投影这些已公开动作的牌面、牌 ID、通配解释和过牌标记；绝不投影
  其他手牌、完整 `cardsById`、seed 或隐藏评估。
- 共享 `PublicActions` 对 `play` 只渲染显式提供的公开牌面，不再以“已出”替代。
- 多人桌面中心文案与单人牌桌一致：存在最高牌时显示“当前牌由…压住”；没有
  最高牌时才显示“…领出”。

## 验证

- `frontend/src/multiplayer/MultiplayerTable.test.tsx`：北家先出 `9`、西家以
  大王压住时，两个座位均显示真实牌面，中央只称西家为当前最高牌者而不称领出者。
- `frontend/src/multiplayer/MultiplayerApp.test.tsx`：牌桌仅从权威 `publicActions`
  显示公开最高牌。
- 后端 `test:p3-09`：四席个人投影安全回归通过。
