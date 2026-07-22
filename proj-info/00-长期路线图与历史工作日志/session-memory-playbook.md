# 新 session 资料读取与交接规范

## 目录定位

`00-长期路线图与历史工作日志/` 保存长期路线图和已结束工作的日志；它不是当前任务
台账。当前任务状态、验收门槛与禁止项必须以 `proj-info/phases/`、ADR 和 `AGENTS.md`
为准。

## 新 session 必读顺序

1. 根目录 `AGENTS.md`。
2. `proj-info/phases/README.md`，识别活动阶段和历史归档。
3. `proj-info/phases/P1-P3-execution-plan.md`，定位唯一可启动任务。
4. 与该任务相关的最新 ADR、`docs/resolved-rules.md`、`docs/architecture.md`。
5. 对应阶段的 `README.md`、`tasks.md`、`test-matrix.md`、`release.md`。
6. `git status --short`、最近提交，以及仅在存在未完成事项时阅读最新 handoff。

对于 P3-01，先读取总表中的 P3-01、P2 release、最新 ADR 和架构文档；无需读取本
目录的旧 `findings.md`、`progress.md` 或 `task_plan.md`。

## 何时写 handoff

- 任务未完成、存在失败测试、外部服务状态、人工验收结果、环境限制或明确禁区时，写入
  `proj-info/handoffs/`。
- 已完成且阶段/发布记录已更新、工作区干净时，不必为了新 session 额外写 handoff。

## 每个活动阶段的最小文件

- `README.md`：目标、范围外内容、完成定义。
- `tasks.md`：小任务、依赖、状态与验证命令。
- `test-matrix.md`：固定牌例、自动对局、E2E、信息边界与性能覆盖。
- `release.md`：Git commit、Preview/Production、验证结果与回滚目标。

ADR 位于 `proj-info/adr/`；不可逆或跨阶段选择必须先记录 ADR。
