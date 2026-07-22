# 工作日志

> 历史日志：最后更新于 2026-07-15。当前阶段状态见 `proj-info/phases/README.md` 与
> `proj-info/phases/P1-P3-execution-plan.md`。

## 2026-07-15

- P1-01 至 P1-20 已完成并发布；当前规则版本为 `guandan-v4`，存档 schema 为 4，交接入口为 `proj-info/phases/P1/phase-1-closeout.md`。
- P2-01 至 P2-05 已验收：响应式/触摸牌桌、版本化 PWA 静态壳与更新确认、BotView 策略观察模型、普通难度机器人和 10,000 局对测基准均已完成。
- P2-06 已完成 Preview/Production 发布，Production 已关闭 Vercel SSO Deployment Protection 并验证匿名 HTTP 200；Chrome 已验证 PWA 更新、离线重载和 390×844 / 844×390 无横向溢出。
- 最新用户回归修复：横排手牌点击区域与牌面同宽；正式牌桌改为使用普通策略机器人，跟牌时避免无必要炸弹、拆小王对子和拆自然顺子。全量 Vitest 串行复核为 24 个测试文件 / 118 项通过，生产构建通过。
- P2-06 尚缺 iPhone Safari “添加到主屏幕后飞行模式离线启动”的人工证据；在完成前 P3-01 不启动。

## 2026-07-13

- 已建立本次规划的持久化工作文件（目录现名为 `proj-info/00-长期路线图与历史工作日志/`），以遵守根目录精简约束。
- 已盘点根目录和 `docs`：尚无项目级 AGENTS.md；已定位初步规划与两份掼蛋规则 PDF。
- 已完整阅读初步需求；已确认本轮不实现游戏代码，目标是产出可执行的规划与架构基线。
- PDF 处理工具和 Python PDF 库均未预装；已将临时依赖安装到被忽略的 `temp/pdf-tools`，提取两份 PDF 并视觉检查比赛规则页。
- 已创建 `docs/resolved-rules.md`（统一规则草案与 6 项待裁定）、`docs/architecture.md`（边界/目录/类型），以及 `platform-roadmap.md`、`session-memory-playbook.md`。
- 已核实 GitHub remote 与 `main` 分支，并查询 Vercel 官方部署/计划资料；本轮未执行 GitHub 或 Vercel 的外部写入。
- 下一步：复核规划一致性，完成本轮文档交付。
- 用户追加要求：在正式开发前建立项目控制/说明文件，生成 P1-P3 子任务执行表，并审查 `.gitignore`。已开始第 6 阶段。
- 已新增根目录 `AGENTS.md`（正式规范）、`AGENT.md`（兼容入口）和 `README.md`，以及 `proj-info/phases/` 的执行记录入口与 P1-P3 任务表。
- 已将 `.gitignore` 从不完整的临时规则更新为依赖、构建、测试、密钥、Vercel、运行时数据、编辑器和系统文件规则；验证了 7 类应忽略项与 5 类应跟踪项。
- P1-P3 共规划 32 个顺序任务；P1-01 已验收，其余任务尚未开始。P1-02 及后续规则任务仍受 P0 的规则待确认项阻塞。
- 用户明确授权后，P1-01 已完成并验收：创建 `frontend/` React + TypeScript + Vite 环境，加入 Vitest、ESLint、Prettier 和 GitHub Actions CI；未实现规则/UI。
- 使用 `npm.cmd` 规避本机 PowerShell 对 `npm.ps1` 的执行策略限制。npm 缓存固定在 `temp/.npm-cache`，并验证所有临时依赖/构建产物被忽略。
- 已删除冗余的 `AGENT.md` 兼容入口；唯一项目级代理规范为根目录 `AGENTS.md`。
