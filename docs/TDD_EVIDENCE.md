# TDD 证据

## 2026-08-29 — Socket.IO same-origin TypeScript repair

RED:

- `npm run lint` exited 1 at `server/src/system.ts:27` with TS2769: `false` is not assignable to Socket.IO's `CorsOptions | CorsOptionsDelegate | undefined`.

Production repair:

- Removed `cors: false` from the Socket.IO constructor and retained `path: '/socket.io'`. Leaving CORS unconfigured is the smallest same-origin configuration: it adds no cross-origin allowance and requires no cast or TypeScript relaxation.

Acceptance-harness repair found while proving GREEN:

- The first acceptance run exited 1 because its JSON helper eagerly consumed every response body for an assertion message and then read it again. The diagnostic read now uses `response.clone()`, without changing application behavior or acceptance coverage.

GREEN:

| Command | Result |
|---|---|
| `npm run lint` | PASS (exit 0; server and client TypeScript checks) |
| `npm test` | PASS (exit 0; 6 files, 12/12 tests) |
| `npm run build` | PASS (exit 0; server TypeScript and client Vite production build) |
| `npm run acceptance` | PASS (exit 0; `ACCEPTANCE OK (16 audit entries verified)`) |

日期：2026-08-29。工作树初始为空。以下命令均在本仓库根目录执行。

## RED 1 — 登录与角色鉴权

命令：`npm test -- --run server/test/auth.test.ts`

结果：RED（退出码 1）— 测试先于实现和依赖安装创建；Windows 报告 `'vitest' is not recognized as an internal or external command`。

## RED 2/3 — 入库、日志、消息、调动、废弃与非法柜层

命令：`npm test -- --run server/test/inventory.test.ts`

结果：RED（退出码 1）— 同一初始依赖前置失败，库存行为测试已存在、生产路由尚未实现。

## RED 4/5 — 采购状态机、目录、危险品路由与偏好

命令：`npm test -- --run server/test/purchases.test.ts server/test/routing.test.ts`

结果：RED（退出码 1）— 同一初始依赖前置失败，采购和路由行为测试已存在、生产路由尚未实现。

## RED 6 — Socket.IO 双客户端

命令：`npm test -- --run server/test/realtime.test.ts`

结果：RED（退出码 1）— 同一初始依赖前置失败，实时行为测试已存在、生产事件路径尚未完成。

## RED 7 — 前端关键组件与角色逻辑

命令：`npm test -- --run client/src/App.test.tsx`

结果：RED（退出码 1）— 同一初始依赖前置失败，组件测试已存在、React 操作台尚未实现。

## 依赖与 GREEN 阻塞证据

命令：`npm install --offline --cache .npm-cache --no-audit --no-fund`

结果：失败（退出码 1，`ENOTCACHED`）— 本工作树没有缓存的 `@types/express` 等 npm 包。任务禁止访问 Web，因此没有回退到 npm registry，也没有从其他仓库或用户目录复制依赖。

最终实际命令：

| 命令 | 结果 |
|---|---|
| `npm test` | 失败（退出码 1）：`vitest` 未安装 |
| `npm run build` | 失败（退出码 1）：`tsc` 未安装 |
| `npm run lint` | 失败（退出码 1）：`tsc` 未安装 |
| `npm run acceptance` | 失败（退出码 1）：前置服务端构建找不到 `tsc` |

因此没有伪造 GREEN 记录，也不能诚实声称完成了严格的运行时 RED→GREEN 循环。依赖可用后应依次重跑每个上方切片命令，修复至 GREEN，再运行全套四条命令。

## 无第三方依赖的本地检查

- `node --experimental-strip-types --check` 检查全部 `server/**/*.ts` 和 `shared/**/*.ts`：PASS。
- 使用 Node 22 内置 `node:sqlite` 从 `server/src/database.ts` 提取并在空内存数据库执行完整 DDL：PASS，创建 8 张预期表。
- PowerShell `ConvertFrom-Json` 解析全部 JSON 配置：PASS。
- `git diff --check`：PASS。
