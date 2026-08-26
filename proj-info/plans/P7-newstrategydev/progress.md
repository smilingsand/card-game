# P7 策略升级：进度记录

## 2026-08-26：规划会话

- **状态：** 规划已完成，等待批准进入 P7-00。
- 已创建并切换 Git 分支：`P7-newstrategydev`。
- 读取项目阶段入口、P3 状态、规则/架构说明、当前 BotView、normal-vNext、模拟器，以及上游 GitHub README 与策略源码。
- 已确认工作区原本存在未提交的 `.gitignore` 修改；本会话未修改或暂存它。
- 已创建：
  - `proj-info/plans/P7-newstrategydev/task_plan.md`
  - `proj-info/plans/P7-newstrategydev/findings.md`
  - `proj-info/plans/P7-newstrategydev/progress.md`
- 已确认上述文件受既有 `proj-info/` 忽略规则影响；将仅以 `git add -f` 纳入这三份 P7 规划文件，且不触碰用户已有的 `.gitignore` 修改。
- 已提交规划到 `P7-newstrategydev`：`43af860 P7-00: add new strategy development plan`。

## 验证

| 检查 | 结果 |
| --- | --- |
| 当前分支 | `P7-newstrategydev` |
| 策略代码改动 | 无 |
| 已有未提交改动 | 仅 `.gitignore`，非本会话产生 |

## 已知问题

| 问题 | 处理 |
| --- | --- |
| 历史 ADR 文件名与先前引用不一致 | P7-00 先核对现有 ADR 索引，并新建 P7 专用 ADR。 |
| `proj-info/` 被 `.gitignore` 整体忽略 | 仅强制跟踪本计划的三份文件，保持其余忽略策略不变。 |

## 2026-08-26：P7-00 完成

- **状态：** accepted。
- 用户已明确授权开始 P7-00，并要求遇到安全或架构问题时暂停而非强行继续。
- 已确认 ADR-0014 与 ADR-0024 是 P7 的现有策略边界；将新增 ADR-0035，而不重写历史 ADR。
- 已确认可复用现有 `bot-benchmark` 与固定 seed `simulation`，不建立第二套模拟器。
- 第一次运行 normal-vNext 模拟命令成功结束，但 `--output-dir=../temp/...` 未落在预期工作区路径；已改为下一次传入绝对输出目录，不重复使用该相对路径。
- 绝对路径目录可创建但没有报告文件，确认 `vite-node` 未把策略参数传给脚本。下一次将用额外的 `--` 分隔 vite-node 参数与脚本参数；若仍失败则暂停，不改造现有脚本。
- 第三次以 `-- --profile=...` 显式转发参数仍退出 0 且未写入报告。按用户要求，P7-00 在此暂停；未改动现有策略代码或模拟脚本。
- 用户已授权修复/替换基线命令。根因定位为 `vite-node` 缺少 `--script`；已将脚本改为显式转发业务参数。直接验证另遇沙箱阻止 Vite 写入 `.vite-temp`，将申请受控权限重跑。
- 修复后的受控 seed 0 冒烟已生成 `report.json` 并完成一局合法结算。随后五 seed 汇总和 seed 1 独立命令均只打印启动行即结束，未生成报告，连命令尾部的 `Test-Path` 都未执行。P7-00 再次暂停，未继续尝试命令变体。
- 直接前台运行 `vite-node --script` 的 seed 1 诊断同样提前结束且无输出，排除 npm 包装器是唯一原因；该多 seed 长运行限制留待 P7-05 收敛门槛在合适执行环境重新验证。
- 按用户要求完成运行器重构：新增 `frontend/scripts/normal-vnext-simulation-runner.ts`，CLI 仅保留参数解析、校验和调用；`vite-node --script` 作为命令入口保证业务参数传入 CLI。
- 新增运行器单测，覆盖固定 seed 调度、依赖注入、报告输出和失败局拒绝；已纳入 `test:core`。
- 已新增 ADR-0035 与 P7 阶段 README、任务表、测试矩阵、发布记录。固定 seed 0 自动对局生成报告并完成合法结算（126 动作，north/south/west/east）。
