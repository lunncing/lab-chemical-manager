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

## 2026-08-30 — UI fix V2（采购模式、消息筛选、采购状态中文化）

工作目录：`D:\hermes\worktrees\lab-chemical-manager-ui-fix-v2`

### Slice 1 — `all -> catalog_normal -> all` 与五种采购模式

RED 命令：

```text
npm test -- --run client/src/purchase-view.test.tsx
```

RED 输出（退出码 1）：

```text
> lab-chemical-manager-v1@1.0.0 test
> vitest run --run client/src/purchase-view.test.tsx

 RUN  v3.2.7 D:/hermes/worktrees/lab-chemical-manager-ui-fix-v2

 FAIL  client/src/purchase-view.test.tsx [ client/src/purchase-view.test.tsx ]
Error: Cannot find module './purchase-view.js' imported from 'D:/hermes/worktrees/lab-chemical-manager-ui-fix-v2/client/src/purchase-view.test.tsx'
 ❯ client/src/purchase-view.test.tsx:2:1
      1| import { describe, expect, it } from 'vitest';
      2| import { purchaseRequestPath, purchaseTabs, type PurchaseViewMode } fr…
       | ^
      3|
      4| describe('purchase view modes', () => {

Caused by: Error: Failed to load url ./purchase-view.js (resolved id: ./purchase-view.js) in D:/hermes/worktrees/lab-chemical-manager-ui-fix-v2/client/src/purchase-view.test.tsx. Does the file exist?

 Test Files  1 failed (1)
      Tests  no tests
```

GREEN 命令：

```text
npm test -- --run client/src/purchase-view.test.tsx
```

GREEN 输出（退出码 0）：

```text
> lab-chemical-manager-v1@1.0.0 test
> vitest run --run client/src/purchase-view.test.tsx

 RUN  v3.2.7 D:/hermes/worktrees/lab-chemical-manager-ui-fix-v2

 ✓ client/src/purchase-view.test.tsx (3 tests) 3ms

 Test Files  1 passed (1)
      Tests  3 passed (3)
```

### Slice 2 — 通知类别与阅读状态组合筛选

RED 命令：

```text
npm test -- --run client/src/notification-filter.test.tsx
```

RED 输出（退出码 1）：

```text
> lab-chemical-manager-v1@1.0.0 test
> vitest run --run client/src/notification-filter.test.tsx

 RUN  v3.2.7 D:/hermes/worktrees/lab-chemical-manager-ui-fix-v2

 FAIL  client/src/notification-filter.test.tsx [ client/src/notification-filter.test.tsx ]
Error: Cannot find module './notification-filter.js' imported from 'D:/hermes/worktrees/lab-chemical-manager-ui-fix-v2/client/src/notification-filter.test.tsx'
 ❯ client/src/notification-filter.test.tsx:3:1
      1| import { describe, expect, it } from 'vitest';
      2| import type { NotificationItem } from './types.js';
      3| import { filterNotifications, notificationCategoryOptions, notificatio…
       | ^
      4|
      5| const item = (id: number, category: string, readAt: string | null): No…

Caused by: Error: Failed to load url ./notification-filter.js (resolved id: ./notification-filter.js) in D:/hermes/worktrees/lab-chemical-manager-ui-fix-v2/client/src/notification-filter.test.tsx. Does the file exist?

 Test Files  1 failed (1)
      Tests  no tests
```

GREEN 命令：

```text
npm test -- --run client/src/notification-filter.test.tsx
```

GREEN 输出（退出码 0）：

```text
> lab-chemical-manager-v1@1.0.0 test
> vitest run --run client/src/notification-filter.test.tsx

 RUN  v3.2.7 D:/hermes/worktrees/lab-chemical-manager-ui-fix-v2

 ✓ client/src/notification-filter.test.tsx (2 tests) 2ms

 Test Files  1 passed (1)
      Tests  2 passed (2)
```

### 全量验收

命令：`npm test`

输出（退出码 0）：

```text
> lab-chemical-manager-v1@1.0.0 test
> vitest run

 RUN  v3.2.7 D:/hermes/worktrees/lab-chemical-manager-ui-fix-v2

 ✓ client/src/purchase-status.test.tsx (2 tests) 2ms
 ✓ client/src/purchase-view.test.tsx (3 tests) 4ms
 ✓ client/src/notification-filter.test.tsx (2 tests) 4ms
 ✓ client/src/App.test.tsx (2 tests) 13ms
(node:31064) ExperimentalWarning: SQLite is an experimental feature and might change at any time
(Use `node --trace-warnings ...` to show where the warning was created)
(node:39352) ExperimentalWarning: SQLite is an experimental feature and might change at any time
(Use `node --trace-warnings ...` to show where the warning was created)
(node:22116) ExperimentalWarning: SQLite is an experimental feature and might change at any time
(Use `node --trace-warnings ...` to show where the warning was created)
(node:32512) ExperimentalWarning: SQLite is an experimental feature and might change at any time
(Use `node --trace-warnings ...` to show where the warning was created)
(node:36356) ExperimentalWarning: SQLite is an experimental feature and might change at any time
(Use `node --trace-warnings ...` to show where the warning was created)
 ✓ server/test/realtime.test.ts (2 tests) 554ms
   ✓ authenticated Socket.IO realtime > delivers one committed change to two authenticated clients without refresh  353ms
 ✓ server/test/auth.test.ts (2 tests) 610ms
   ✓ authentication and server-side roles > logs in with an HttpOnly cookie and rejects invalid credentials  321ms
 ✓ server/test/inventory.test.ts (2 tests) 690ms
   ✓ inventory vertical slice > persists inbound stock in its shelf with atomic audit and routed messages  314ms
   ✓ inventory vertical slice > moves another member’s chemical, discards without deleting, and rejects invalid shelf data  375ms
 ✓ server/test/routing.test.ts (2 tests) 832ms
   ✓ catalog and notification routing > routes approved normal, urgent, and hazardous requests to the correct catalogs  550ms
 ✓ server/test/purchases.test.ts (2 tests) 866ms
   ✓ purchase request state machine > lets normal admins decide normal requests while enforcing comments and optimistic versions  392ms
   ✓ purchase request state machine > restricts urgent approval to super admins and owner-only editing/withdrawal  473ms

 Test Files  9 passed (9)
      Tests  19 passed (19)
   Duration  1.59s (transform 274ms, setup 0ms, collect 1.97s, tests 3.57s, environment 2ms, prepare 779ms)
```

命令：`npm run lint`

输出（退出码 0）：

```text
> lab-chemical-manager-v1@1.0.0 lint
> tsc -p server/tsconfig.json --noEmit && tsc -p client/tsconfig.json --noEmit
```

命令：`npm run build`

输出（退出码 0）：

```text
> lab-chemical-manager-v1@1.0.0 build
> npm run build:server && npm run build:client

> lab-chemical-manager-v1@1.0.0 build:server
> tsc -p server/tsconfig.json

> lab-chemical-manager-v1@1.0.0 build:client
> vite build --config client/vite.config.ts

vite v7.3.6 building client environment for production...
transforming...
✓ 65 modules transformed.
rendering chunks...
computing gzip size...
dist/index.html                   0.44 kB │ gzip:  0.34 kB
dist/assets/index-J2T_iyel.css    9.21 kB │ gzip:  2.85 kB
dist/assets/index-BdOKLEf6.js   259.77 kB │ gzip: 80.87 kB
✓ built in 578ms
```

命令：`npm run acceptance`

输出（退出码 0）：

```text
> lab-chemical-manager-v1@1.0.0 acceptance
> npm run build:server && node server/dist/server/scripts/acceptance.js

> lab-chemical-manager-v1@1.0.0 build:server
> tsc -p server/tsconfig.json

(node:10176) ExperimentalWarning: SQLite is an experimental feature and might change at any time
(Use `node --trace-warnings ...` to show where the warning was created)
PASS health: empty in-memory SQLite database returns 200
PASS roles: five demo logins and server-side 403/200 authorization
PASS inventory/realtime: inbound, cross-owner move, invalid shelf, discard, two Socket.IO clients
PASS purchase state machine: normal/urgent/hazardous, approve/defer/revise/reject/withdraw, forbidden urgent approval
PASS dangerous-goods routing: normal/urgent catalogs and hazardous buyer queue
PASS preferences/audit: future category blocked while inventory and immutable public audit remain
ACCEPTANCE OK (16 audit entries verified)
```

命令：`git diff --check`

输出（退出码 0；无空白错误，只有 Git 换行符提示）：

```text
warning: in the working copy of 'client/src/views.tsx', LF will be replaced by CRLF the next time Git touches it
warning: in the working copy of 'docs/TDD_EVIDENCE.md', LF will be replaced by CRLF the next time Git touches it
```

### Slice 3 — 六种采购状态中文标签

RED 命令：

```text
npm test -- --run client/src/purchase-status.test.tsx
```

RED 输出（退出码 1）：

```text
> lab-chemical-manager-v1@1.0.0 test
> vitest run --run client/src/purchase-status.test.tsx

 RUN  v3.2.7 D:/hermes/worktrees/lab-chemical-manager-ui-fix-v2

 FAIL  client/src/purchase-status.test.tsx [ client/src/purchase-status.test.tsx ]
Error: Cannot find module './purchase-status.js' imported from 'D:/hermes/worktrees/lab-chemical-manager-ui-fix-v2/client/src/purchase-status.test.tsx'
 ❯ client/src/purchase-status.test.tsx:2:1
      1| import { describe, expect, it } from 'vitest';
      2| import { purchaseStatusLabel, purchaseStatusOptions } from './purchase…
       | ^
      3|
      4| describe('purchase status labels', () => {

Caused by: Error: Failed to load url ./purchase-status.js (resolved id: ./purchase-status.js) in D:/hermes/worktrees/lab-chemical-manager-ui-fix-v2/client/src/purchase-status.test.tsx. Does the file exist?

 Test Files  1 failed (1)
      Tests  no tests
```

GREEN 命令：

```text
npm test -- --run client/src/purchase-status.test.tsx
```

GREEN 输出（退出码 0）：

```text
> lab-chemical-manager-v1@1.0.0 test
> vitest run --run client/src/purchase-status.test.tsx

 RUN  v3.2.7 D:/hermes/worktrees/lab-chemical-manager-ui-fix-v2

 ✓ client/src/purchase-status.test.tsx (2 tests) 2ms

 Test Files  1 passed (1)
      Tests  2 passed (2)
```
