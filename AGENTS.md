# AGENTS.md - 扑克牌游戏平台开发规范

本文件是本仓库的项目级开发合同。所有开发 session 开始前必须阅读；如与通用规则冲突，以本文件和当前用户要求为准。

## 1. 产品与当前边界

- 产品：可扩展的双副牌扑克游戏平台；第一款完整游戏是单人本地掼蛋。
- 当前阶段：P0 规则冻结完成前，禁止实现正式规则、UI、机器人或联网功能。
- P1 范围：浏览器内的 1 名人类 + 3 个基础机器人、确定性规则、本地 IndexedDB 存档；无账号、后端、数据库、联网、排行榜或付费功能。
- P2 范围：同一前端的移动/PWA 和策略机器人；不得改变已冻结规则。当前唯一产品机器人为 normal-vNext；normal-v1 只作离线历史对照，P2.5 expert 路线已撤销，恢复必须先新增 ADR。
- P3 范围：权威服务端、多玩家房间、重连和托管；客户端不得裁决规则或持有他人手牌。

## 2. 事实来源与规则优先级

1. 当前用户明确要求；
2. `docs/resolved-rules.md`（规则实现唯一产品口径，须先关闭其中的待确认项）；
3. `docs/architecture.md`；
4. `proj-info/phases/P1-P3-execution-plan.md`（活动任务状态和验收门槛；P2.5 为历史归档）；
5. 原始规则 PDF 和初步需求文档（仅作追溯资料，不可在运行时解释规则）。

任何规则、事件 schema、存档 schema、随机数、多人协议或第三方服务的不可逆选择，先写 ADR，再实现。

## 3. 目录合同

```text
docs/       稳定、面向使用者的规则和说明
proj-info/  开发治理、ADR、阶段计划、验收、发布和交接记录
frontend/   浏览器应用、前端测试和构建配置
backend/    P3 起创建的权威服务端
tools/      可复用且有 README 的开发工具，不存临时脚本
temp/       可删除的中间产物，永不提交
```

根目录只保留必要的控制文件和一级目录：`.agents`、`.codex`、`.github`、`AGENTS.md`、`README.md`、`LICENSE`、`.gitignore`、`docs`、`proj-info`、`tools`、`temp`、`frontend`、`backend`。不得在根目录留下构建产物、报告、截图、依赖或临时脚本。

## 4. 架构与安全硬约束

- 核心规则是纯 TypeScript：同样的 `seed + initial state + actions` 必须得到同样结果；不得依赖 React、DOM、时间或网络。
- 公共 `platform` 层不得导入掼蛋/拖拉机专属类型；每个游戏只能通过插件边界接入。
- 每张实体牌必须有唯一 ID；禁止以点数或花色作为身份。
- 人类与机器人都只能提交动作，必须经过同一个 `validateAction` 和 `applyAction`。
- 机器人只可接收自己的手牌、公开事件、各家剩余牌数和合法动作；类型和测试中都不得传入对手手牌。
- P3 服务端是唯一权威状态；客户端只接收个人视图投影。不得下发随机种子、其他手牌或机器人隐藏评估。
- 存档采用版本化事件流和快照；规则变更必须新增 `rulesVersion`，不得静默重解释旧存档。
- 密钥、令牌、真实用户数据和 `.env` 禁止提交或在日志/回复中回显。

## 5. 执行、测试与发布

1. 从 `proj-info/phases/P1-P3-execution-plan.md` 选择唯一一个依赖已满足且非 `revoked` 的 `not_started` 任务，并将其标记为 `in_progress`。
2. 先写/更新固定牌例或失败测试，再写最小实现；不在同一任务中顺带扩展其他阶段。
3. 任务完成后依次运行：格式化 → typecheck → lint → 单元/固定牌例 → 自动对局（适用时）→ E2E 冒烟（适用时）。
4. 只有所有测试条件通过、验收标准有证据、阶段文档更新后，才将任务标记为 `accepted`。
5. 每个 P 阶段完成时：PR Preview 验收 → 合并 `main` → Vercel Production 验证 → 写入 `release.md`；失败时先回滚生产版本。

提交信息采用 `<任务编号>: <简短中文或英文说明>`，例如 `P1-06: implement guandan pattern recognizer`。一个提交只包含一个已验收的任务，除非任务计划明确说明不可拆分。

## 6. 上下文管理

- 开始 session：阅读本文件、[阶段入口](proj-info/phases/README.md)、活动阶段计划、最新 ADR、`docs/resolved-rules.md`、最近的 `release.md` 和 `git status --short`。
- 结束或交接：更新任务状态、实际验证命令/结果、已知风险；未完成工作写入 `proj-info/handoffs/`。
- 聊天记录不是项目事实来源；长期结论必须写入 `proj-info/` 或 `docs/`。
