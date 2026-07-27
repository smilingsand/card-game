# P3-11 本地浏览器人工验收

状态：`ready_for_acceptance`。本手册只覆盖本地 Vite → Wrangler → SQLite Durable Object；不得登录 Cloudflare、部署 Preview 或 Production。P3-07 多人牌桌修复完成后，按本手册重新收集人工证据。

## 启动

首次运行时，在 `backend/` 复制 `.dev.vars.example` 为未提交的 `.dev.vars`，并按文件注释生成本地密钥。随后保持两个 PowerShell 窗口运行：

```powershell
cd D:\MyWorks\card-game\backend
npm.cmd run dev
```

```powershell
cd D:\MyWorks\card-game\frontend
npm.cmd run dev -- --host 127.0.0.1
```

打开 Vite 控制台显示的本地地址（通常为 `http://127.0.0.1:5173`）。单人牌桌右下角的“多人联机”按钮必须可见并可点击；点击后匿名会话自动建立，不设传统登录页。Worker 健康检查应为：

```powershell
Invoke-WebRequest http://127.0.0.1:8788/health | Select-Object -ExpandProperty StatusCode
```

预期为 `200`。保存 Wrangler 终端日志（不要记录 Cookie、邀请密钥或任何手牌截图以外的开发者工具敏感值）。

## 四个独立客户端入房

1. 启动四个彼此独立且保留各自 Cookie 的浏览器 profile/浏览器窗口；不要用会共享 Cookie 的同一 profile 普通窗口。建议 Chrome profile A–D，或四个独立浏览器 profile。
2. 每个窗口打开本地 Vite 地址，选择“多人联机”。窗口 A 创建房间，选择 `south`；记录房间 ID 与邀请码。
3. 窗口 B、C、D 分别用同一房间 ID 与邀请码加入 `east`、`north`、`west`。四人使用不同名称。
4. 四个窗口分别点“准备”；由房主点“开始牌局”。
5. 在四个窗口截图，核对每个窗口的 `bottom` 都是自己的逻辑座位；相对映射固定为 bottom/left/top/right，队友是对家，逻辑行动顺序仍为 south → east → north → west。

预期：每个客户端只显示自己的 27 张手牌；其余三家只显示剩余张数；房间 ID、座位、队友与上下家映射在四个窗口一致。

## 一个完整回合

1. 观察牌桌中央“轮到”座位。领出者在自己的下方手牌区选择一张或多张牌；只有与服务器个人投影的 `legalActions` 完全匹配的选牌才会启用“出牌”。
2. 其余三家依次在自己的窗口点击“过牌”。不要在领出者点击“过牌”。
3. 截图四个窗口的当前行动、手牌张数及最近公共动作。

预期：恰有一张出牌与三次过牌；没有重复出牌、非法动作提示、事件序号倒退或卡局；最后成功出牌者重新领出。若该玩家继续操作，重复上述步骤可推进整局结算。

## 断线、重连与缺口补发

1. 任选一个窗口打开开发者工具 Network，保留 WebSocket 帧列表；记录最后收到的 `serverEvent.payload.eventSequence`，该记录不得包含 Cookie。
2. 用开发者工具 Network 的 Offline 模式使该窗口掉线（不要关闭整个浏览器 profile）。在另外三个窗口完成一次合法动作，使服务器产生新的公共事件。
3. 恢复 Online，在掉线窗口点击“重新连接”。
4. 保存掉线前最后序号、恢复后首个补发序号和恢复后的窗口截图；不要导出帧内的私有投影或 Cookie。

预期：该窗口仍为原 logical seat；重连后从断线前最后连续序号之后补发，连续且无重复；不会获得其他座位手牌、seed 或隐藏评估。

## 超时托管与真人恢复

1. 选择当前行动的真人窗口，保持 WebSocket 在线但不要提交动作，等待超过 30 秒。
2. 在 Wrangler 日志中保存脱敏的 room/event 关联记录，并在四个窗口截图当前行动变化。机器人应只为该回合提交一个经 Authority 校验的动作。
3. 保持该真人窗口在线；让其他真人完成必要的合法响应，直到该真人下一次行动边界。
4. 截图该真人窗口恢复为可操作状态及其逻辑座位。

预期：超时只在动作边界转为 `normal-vNext` 托管；机器人动作后该真人仍保持原 `controllerSubjectId` 与原逻辑座位，并在下一个动作边界自动恢复，不需要申请。无状态分叉、重复机器人动作或隐藏信息泄露。

## 证据清单与结论

保存到用户控制的非提交位置：

- 两个启动终端的命令与 `/health` 200；
- 四人入房及四个个人底座映射截图；
- 一个完整回合前后截图；
- 断线前/后脱敏 WebSocket 序号记录、重连截图；
- 超时托管及真人恢复截图、脱敏 Wrangler room/event 日志；
- 任一失败的发生时间、room ID、首个失败事件序号、复现步骤与终端日志。

通过条件：上述六项均满足，且没有非法动作、重复出牌、事件序号倒退/跳号、卡局、状态分叉或隐藏手牌泄露。人工证据完成前，P3-11 不得标记为 `accepted`。
