# P1 测试矩阵

| 检查 | P1-01 命令 | 通过条件 |
| --- | --- | --- |
| 格式化 | `npm.cmd run format:check` | 无格式差异 |
| 类型检查 | `npm.cmd run typecheck` | TypeScript 严格模式无错误 |
| 静态检查 | `npm.cmd run lint` | ESLint 无 error 或 warning |
| 单元测试 | `npm.cmd run test:run` | Vitest 通过 |
| 构建 | `npm.cmd run build` | Vite 生成 `frontend/dist/` |
| Git 忽略 | `git check-ignore` | 依赖、缓存与构建产物均不提交 |

## P1-01 实测结果（2026-07-13）

| 检查 | 结果 |
| --- | --- |
| `npm.cmd run format:check` | 通过 |
| `npm.cmd run typecheck` | 通过 |
| `npm.cmd run lint` | 通过，零 warning |
| `npm.cmd run test:run` | 通过，1 个测试 |
| `npm.cmd run build` | 通过，Vite 6.4.3 生成 `frontend/dist/` |
| Git 忽略 | `temp/.npm-cache`、`node_modules`、`.vite-temp`、`dist` 均已验证忽略；源码、锁文件和 CI 文件均可提交 |
