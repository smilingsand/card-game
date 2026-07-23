# P3-01 测试矩阵

| 验收项                         | 证据                                            | 结果                                                                                             |
| ------------------------------ | ----------------------------------------------- | ------------------------------------------------------------------------------------------------ |
| 名称池、规范化、房内唯一       | `node --test backend/poc/name-policy.test.mjs`  | 2026-07-23：3/3 通过                                                                             |
| 四客户端连接、断连、冷启动恢复 | `cd backend/poc; npm.cmd test`                  | 2026-07-23：Miniflare 四客户端 POC 通过；见 `backend/poc/README.md`                              |
| 成本、连接上限、时延测量       | `cd backend/poc; npm.cmd run measure`；ADR-0025 | 2026-07-23：本地四席/重连批次已测；当前与早期公网 MVP 均固定 Workers Free，线上配额在 P3-12 实测 |
| 本地与公网授权边界             | ADR-0025；P3 README                             | 本地为 Vite → Wrangler → SQLite DO；P3-12 前禁止部署，届时等待用户完成 Free 账号与本机登录授权   |
| 协议版本、CSPRNG、回放权限     | ADR-0026、ADR-0028                              | 设计已冻结；P3-04/P3-06 实现回归                                                                 |

本机 POC 不创建云资源。禁止提交密码、API Key、token、本地登录凭据或 `.env`。Cloudflare 仅承载后端，不替代 Vercel 前端/PWA。
