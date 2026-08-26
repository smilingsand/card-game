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

| 检查           | 结果                          |
| -------------- | ----------------------------- |
| 当前分支       | `P7-newstrategydev`           |
| 策略代码改动   | 无                            |
| 已有未提交改动 | 仅 `.gitignore`，非本会话产生 |

## 已知问题

| 问题                                  | 处理                                               |
| ------------------------------------- | -------------------------------------------------- |
| 历史 ADR 文件名与先前引用不一致       | P7-00 先核对现有 ADR 索引，并新建 P7 专用 ADR。    |
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

## 2026-08-26：P7-01 完成

- **状态：** accepted。
- 新增 `public-action-projection.ts`：从按 sequence 排序的公开动作中，只投影已经出牌的 `{ id, suit, rank }`、动作类型和牌型；不返回 `deckIndex`、牌堆、未出牌或 seed。
- 新增 `strategy-observation.ts`：纯函数生成公开牌/牌型统计、四座剩余手数、最近动作、自己/队友/对手关系及可选赛局公共上下文。
- `TableSession` 由 MatchSession 纯函数重建双方等级、A 关、进贡/抗贡阶段和首出来源；该上下文不进入规则裁决、事件动作或快照。
- 回归中发现存档恢复遗漏该派生上下文，已在 `restoreTableSession` 重建；P3 secure-seed 事件流等价测试随后通过。
- 新增 4 个 P7-01 固定牌例，覆盖公开牌面、顺序重放、旧投影兼容、四座泄露边界与赛局上下文。

## 2026-08-26：P7-02 完成

- **状态：** accepted。
- `scoreNormalVNextCandidate` 只接受规则层 `legalActions` 中的出牌候选，并返回稳定总分、逐项 breakdown 与可读 reasons。
- 分项包括点数、结构破坏、控制资源、红桃级牌逢人配、三带二附带成本、自然复合牌卸载收益和公开残局拦截收益；总分越小越优。
- normal-vNext 的响应候选排序改为消费该评分，仍保留炸弹后置、三带二主三张优先和 JSON 固定 tie-break；没有引入搜索、随机或隐藏信息。
- 新增固定牌例验证总分公式、红桃级牌保护、非法候选拒绝和同分排序；既有 52 个 normal-vNext 牌例全部通过。

## 2026-08-26：P7-03 完成

- **状态：** accepted。
- 新增只读协同信号、公开控制牌暴露统计和炸弹经济诊断；正向炸弹条件限定为保队友、断公开临门对手或直接收尾。
- 新增两组固定牌例。初版把非炸弹 `undefined` 转为 `NaN`，触发 13 个排序回归；已改为明确布尔值，54 个 normal-vNext 牌例全部通过。

## 2026-08-26：P7-04 完成

- **状态：** accepted。
- 新增固定一层的 `estimateNormalVNextSelfRoute`，只在己方手牌中移除候选牌，统计死单、自然组、控制牌保留与估计手数。
- 固定牌例验证确定性与没有对手手牌输入；55 个 normal-vNext 牌例通过。

## 2026-08-26：P7-05 本地收敛证据完成

- **状态：** ready_for_acceptance（未发布）。
- 新增 normal-vNext 专项基准：固定 seed `0, 1, 7, 42, 99` 只构造各 seed 的初始 `BotView` 并测量生产选择器，逐一验证返回动作属于规则层合法动作集。
- 既有 `bot-benchmark.test.ts` 是 normal/basic 百局历史慢测，既不覆盖 normal-vNext 也不适合作为 P7 策略门槛；保留其独立入口，`test:core` 改接 P7 专项基准。
- 用户于 2026-08-26 本地复测通过：测试主体 10.917 秒；最慢单次决策低于 5 秒。5 秒上限由 P7-00 约 3.57 秒最慢决策加回归余量确定。
- 未执行 Preview、合并 main 或 Production 验收；这些外部状态变更须在用户明确授权后单独进行。
