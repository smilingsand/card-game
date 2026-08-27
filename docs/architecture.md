# 扑克牌游戏平台架构基线

## P4 本地多人入口与生命周期

本地多人仍遵循 `Vite → Wrangler Worker → SQLite-backed Durable Object` 的权威边界。浏览器默认显示首页；多人客户端只持有自己的个人投影。牌桌“退出”仅改变本地展示状态，返回房间大厅并抑制旧的实时投影；“继续游戏”必须重新向 Authority 读取个人 `game-view`。大厅右上角退出才改变服务端生命周期：房主关闭整个房间，非房主仅断开自己的 presence/WebSocket。关闭房间会协调清理 Room、Authority 与 Realtime 的持久状态和本地 alarm/task，且向在线客户端广播 `roomClosed`。完整决策见 `proj-info/adr/ADR-0034-p4-explicit-room-exit-and-resume.md`。

## 当前实现状态（P2 已交付；P7 策略收敛已发布）

- 浏览器应用位于 `frontend/`，使用 React、TypeScript、Vite；Vercel 项目 Root Directory 为 `frontend`。
- 当前实现为 1 名人类南家与 3 个 normal-vNext 机器人的本地掼蛋；规则版本为 `guandan-v5`，存档 schema 为 4。P7-00 至 P7-23 已合入 `main` 并于 2026-08-27 完成 Vercel Preview/Production 验收，不改变规则或存档版本；旧规则/存档不做静默迁移。
- 连续多局状态（双方等级、局号、进贡阶段、贡/还贡和首出者）由 `TableSession` 的版本化事件流与快照保存；手动理牌仅为南家的显示偏好，不属于规则事实。
- P2 不引入后端、账号或多人联网；P3 建立本地权威服务端，但公网部署仍需 P3-12。根目录 `settings.ini` 默认禁用多人入口，以支持单人 Vercel 发布。

## 首版技术选择

- `frontend/`：React + TypeScript + Vite；纯静态构建，适合单机掼蛋直接托管于 Vercel。
- 规则与状态：纯 TypeScript 函数，不依赖 React、浏览器 API 或 DOM。
- 测试：Vitest（单元/固定牌例/随机自动对局）；关键桌面交互、移动布局和 PWA 更新时序由组件/单元回归覆盖。P2 仍保留 iPhone Safari 主屏离线启动的最终人工验收。
- 存储：IndexedDB，保存版本化事件流与快照；不把规则状态只放在组件 state。
- PWA：已提供 manifest、Service Worker 与离线壳。Service Worker 仅缓存带构建指纹的静态资源；IndexedDB 事件流、快照和牌局数据不进入 Cache Storage。更新须由用户确认后才激活新 worker，详见 ADR-0013。

选择 Vite 是为了使首版保持完全静态；未来多人能力通过 `backend/` 的权威服务加入，前端不重写。

## 目录契约

```text
card-game/
├── .agents/                    # 代理协作配置（已有）
├── .codex/                     # Codex 配置（已有）
├── docs/                       # 面向使用者和公开规则说明
├── proj-info/                  # 项目规划、ADR、进度和会话记忆
├── frontend/                   # 所有浏览器代码与前端测试
│   ├── src/platform/            # card/table/plugin/storage/event 等公共边界
│   ├── src/games/guandan/       # 掼蛋专属 engine、bots、ui、rules
│   ├── src/app/                 # 路由、页面、主题、应用装配
│   └── tests/                   # UI/E2E 测试
├── backend/                     # P3 才创建：权威房间和实时同步服务
├── tools/                       # 可复用开发脚本；不得放临时代码
└── temp/                        # 可删除的渲染、下载和实验产物
```

根目录不添加构建输出、报告、截图、临时脚本或工具缓存。`frontend/` 是 Vercel 项目 Root Directory；`.vercel/` 必须被 Git 忽略。

`packages/guandan-core/` 是规则、牌型比较、合法动作、事件流、会话状态、BotView 与确定性重放的唯一源码。`frontend/` 与 `backend/` 均通过 `@card-game/guandan-core` 包导出消费它；核心不得导入 React、DOM、Vite、Cloudflare API 或 Node 专属 API，IndexedDB 适配器仅留在 `frontend/src/platform/`。

## 依赖方向

```text
app/ui ──> games/guandan (展示、控制器)
                  └──> platform (cards/table/events/storage 接口)
backend(P3) ──> games/guandan engine + platform
```

- `platform/` 不得导入掼蛋类型。
- `engine/` 必须是确定性 reducer：`state + action -> nextState / validation error`。
- 客户端仅持有自己手牌和公共投影；服务器完整状态只在 P3 引入。
- 机器人输入是 `BotView`（自己的手牌 + 公开事件 + 合法动作），类型上不暴露对手手牌。
- normal-vNext 只从 `BotView` 的己方手牌、公开事件、剩余张数和完整合法动作进行评分。它已接入公开 observation、己方路线、协同/炸弹经济、普通争牌和公开残局判断；天然四张及以上同点数炸弹绝不拆分。规则层仍负责动作合法性。策略观察模型详见 ADR-0035，产品策略替换边界见 ADR-0024。

## 最小领域接口

```ts
type CardId = string;
type PlayerId = string;
type GameId = "guandan" | "tractor-80";

interface Card {
  id: CardId;
  deckIndex: number;
  suit: Suit;
  rank: Rank;
}
interface GamePlugin<State, Action, View> {
  readonly gameId: GameId;
  createInitialState(options: unknown, seed: number): State;
  getLegalActions(state: State, playerId: PlayerId): readonly Action[];
  validateAction(state: State, action: Action): ValidationResult;
  applyAction(state: State, action: Action): State;
  projectForPlayer(state: State, playerId: PlayerId): View;
}
interface GameEvent {
  sequence: number;
  type: string;
  actorId?: PlayerId;
  payload: unknown;
}
```

## 状态与回放

`seed + initial options + append-only GameEvent[]` 是可复现事实来源；每 N 个事件保存一个快照用于快速恢复。任何规则变更都增加 `rulesVersion`，旧存档不自动用新规则解释。
