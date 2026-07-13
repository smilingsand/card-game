# 扑克牌游戏平台架构基线

## 首版技术选择

- `frontend/`：React + TypeScript + Vite；纯静态构建，适合单机掼蛋直接托管于 Vercel。
- 规则与状态：纯 TypeScript 函数，不依赖 React、浏览器 API 或 DOM。
- 测试：Vitest（单元/固定牌例/属性或随机局）；Playwright（关键桌面与移动交互）。
- 存储：IndexedDB，保存版本化事件流与快照；不把规则状态只放在组件 state。
- PWA：仅在单机核心稳定后加入 Service Worker、manifest 和离线壳。

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

## 最小领域接口

```ts
type CardId = string;
type PlayerId = string;
type GameId = "guandan" | "tractor-80";

interface Card { id: CardId; deckIndex: number; suit: Suit; rank: Rank }
interface GamePlugin<State, Action, View> {
  readonly gameId: GameId;
  createInitialState(options: unknown, seed: number): State;
  getLegalActions(state: State, playerId: PlayerId): readonly Action[];
  validateAction(state: State, action: Action): ValidationResult;
  applyAction(state: State, action: Action): State;
  projectForPlayer(state: State, playerId: PlayerId): View;
}
interface GameEvent { sequence: number; type: string; actorId?: PlayerId; payload: unknown }
```

## 状态与回放

`seed + initial options + append-only GameEvent[]` 是可复现事实来源；每 N 个事件保存一个快照用于快速恢复。任何规则变更都增加 `rulesVersion`，旧存档不自动用新规则解释。

