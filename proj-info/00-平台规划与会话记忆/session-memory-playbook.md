# 跨会话工作记忆规范

## 目录与职责

```text
proj-info/
├── 00-平台规划与会话记忆/      # 本文件、路线图、当前规划工作日志
├── decisions/                  # ADR：不可逆或跨阶段决策
├── phases/                     # 每一阶段的计划、验收、发布记录
└── handoffs/                   # 未完成工作交接单（完成后归档）
```

`docs/` 保存稳定、面向使用者的规则/操作资料；`proj-info/` 保存开发事实。临时调查、截图和依赖只能放 `temp/`，完成后删除。

## 新 session 必读顺序

1. 根目录 `AGENTS.md`（创建后）及最近的 `proj-info/phases/<active>/README.md`。
2. `proj-info/decisions/` 最新 ADR、`docs/resolved-rules.md` 与当前规则版本。
3. 当前阶段验收清单、最近发布记录、`git status --short` 和最近两次 commit。
4. 只在需要时阅读 `handoffs/`；读完后先复述当前阶段、未决项和验证命令，再修改代码。

## 每个阶段的最小文件

- `README.md`：目标、范围外内容、完成定义、负责人/日期。
- `tasks.md`：小任务、依赖、状态、验证命令。
- `findings.md`：规则资料、调查事实、链接和证据（不写成指令）。
- `test-matrix.md`：固定牌例、随机局、E2E、信息泄露和性能覆盖。
- `release.md`：Git commit、Preview/Production URL、部署时间、验证结果、回滚目标。

## ADR 模板

```md
# ADR-NNN：标题
状态：proposed | accepted | superseded
背景：
决策：
备选与取舍：
影响：
验证/迁移：
```

必须记录：规则口径、随机种子、存档 schema、公开事件 schema、多人后端与身份方案、第三方服务、规则版本升级。

## 交接与结束标准

- 未完成：在 `handoffs/YYYY-MM-DD-主题.md` 写清已完成、剩余、阻塞、精确命令、失败输出摘要和不可触碰文件。
- 完成：更新阶段状态、测试矩阵与 `release.md`；删除或归档交接单。
- 所有结论必须引用仓库文件、测试输出或部署记录；不把聊天记忆当成项目事实来源。

