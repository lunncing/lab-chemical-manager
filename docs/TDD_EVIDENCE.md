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

## 2026-08-30 — V1.2 Phase B（§3、§4 采购实时、Slices 6–8）

工作树：`D:/hermes/worktrees/lab-chemical-manager-v1-2-proxy-procurement`

### Slice 6 — 采购任务摘要与角色化队列

RED 命令：

```text
npm test -- --run server/test/purchase-tasks.test.ts
```

RED 输出（退出码 1，新增接口尚不存在）：

```text
> lab-chemical-manager-v1@1.0.0 test
> vitest run --run server/test/purchase-tasks.test.ts

 RUN  v3.2.7 D:/hermes/worktrees/lab-chemical-manager-v1-2-proxy-procurement

 ❯ server/test/purchase-tasks.test.ts (1 test | 1 failed) 630ms
   × role-specific purchase task queues > derives approval and procurement summaries from server-side role queries 629ms
     → expected 404 to be 200 // Object.is equality

 FAIL  server/test/purchase-tasks.test.ts > role-specific purchase task queues > derives approval and procurement summaries from server-side role queries
AssertionError: expected 404 to be 200 // Object.is equality

- Expected
+ Received

- 200
+ 404

 Test Files  1 failed (1)
      Tests  1 failed (1)
```

GREEN 命令：

```text
npm test -- --run server/test/purchase-tasks.test.ts
```

GREEN 输出（退出码 0）：

```text
> lab-chemical-manager-v1@1.0.0 test
> vitest run --run server/test/purchase-tasks.test.ts

 RUN  v3.2.7 D:/hermes/worktrees/lab-chemical-manager-v1-2-proxy-procurement

 ✓ server/test/purchase-tasks.test.ts (1 test) 759ms
   ✓ role-specific purchase task queues > derives approval and procurement summaries from server-side role queries  759ms

 Test Files  1 passed (1)
      Tests  1 passed (1)
```

### Slice 7 — approved → purchased 权限、通知、审计、实时与目录移除

RED 命令：

```text
npm test -- --run server/test/purchased.test.ts
```

RED 输出（退出码 1，接口和任务通知路由尚不存在）：

```text
> lab-chemical-manager-v1@1.0.0 test
> vitest run --run server/test/purchased.test.ts

 RUN  v3.2.7 D:/hermes/worktrees/lab-chemical-manager-v1-2-proxy-procurement

 ❯ server/test/purchased.test.ts (2 tests | 2 failed) 842ms
   × approved to purchased transition > enforces hazardous/nonhazardous roles, approved state, and optimistic versions 451ms
     → expected 404 to be 409 // Object.is equality
   × approved to purchased transition > routes approval tasks, broadcasts completion, notifies the applicant, audits it, and removes it only from active queues 390ms
     → expected [] to deeply equal [ 'admin', 'teacher' ]

 Test Files  1 failed (1)
      Tests  2 failed (2)
```

GREEN 命令：

```text
npm test -- --run server/test/purchased.test.ts server/test/purchase-tasks.test.ts server/test/routing.test.ts server/test/purchases.test.ts
```

GREEN 输出（退出码 0）：

```text
> lab-chemical-manager-v1@1.0.0 test
> vitest run --run server/test/purchased.test.ts server/test/purchase-tasks.test.ts server/test/routing.test.ts server/test/purchases.test.ts

 RUN  v3.2.7 D:/hermes/worktrees/lab-chemical-manager-v1-2-proxy-procurement

 ✓ server/test/purchase-tasks.test.ts (1 test) 788ms
 ✓ server/test/routing.test.ts (2 tests) 818ms
 ✓ server/test/purchases.test.ts (2 tests) 850ms
 ✓ server/test/purchased.test.ts (2 tests) 1041ms

 Test Files  4 passed (4)
      Tests  7 passed (7)
```

### Slice 8 — 前端计数、我的审批、待采购与已采购中文 UI

RED 命令：

```text
npm test -- --run client/src/purchase-status.test.tsx client/src/purchase-view.test.tsx client/src/purchase-tasks-ui.test.tsx
```

RED 输出（退出码 1）：

```text
> lab-chemical-manager-v1@1.0.0 test
> vitest run --run client/src/purchase-status.test.tsx client/src/purchase-view.test.tsx client/src/purchase-tasks-ui.test.tsx

 RUN  v3.2.7 D:/hermes/worktrees/lab-chemical-manager-v1-2-proxy-procurement

 ❯ client/src/purchase-view.test.tsx (3 tests | 3 failed) 9ms
   × purchase view modes > returns to the all-purchases endpoint after opening the normal catalog 6ms
   × purchase view modes > maps all seven modes to their endpoints and applies filters only to list modes 1ms
     → expected '/purchases/catalog/s' to be '/purchases/tasks/approvals' // Object.is equality
   × purchase view modes > exposes only authorized tabs and marks the current catalog tab as pressed 1ms
 ❯ client/src/purchase-status.test.tsx (2 tests | 1 failed) 8ms
   × purchase status labels > maps all seven API status values to Chinese UI labels 6ms

 FAIL  client/src/purchase-tasks-ui.test.tsx [ client/src/purchase-tasks-ui.test.tsx ]
Error: Cannot find module './purchase-tasks-ui.js' imported from 'D:/hermes/worktrees/lab-chemical-manager-v1-2-proxy-procurement/client/src/purchase-tasks-ui.test.tsx'

 Test Files  3 failed (3)
      Tests  4 failed | 1 passed (5)
```

GREEN 命令：

```text
npm test -- --run client/src/purchase-status.test.tsx client/src/purchase-view.test.tsx client/src/purchase-tasks-ui.test.tsx
```

GREEN 输出（退出码 0）：

```text
> lab-chemical-manager-v1@1.0.0 test
> vitest run --run client/src/purchase-status.test.tsx client/src/purchase-view.test.tsx client/src/purchase-tasks-ui.test.tsx

 RUN  v3.2.7 D:/hermes/worktrees/lab-chemical-manager-v1-2-proxy-procurement

 ✓ client/src/purchase-view.test.tsx (3 tests) 4ms
 ✓ client/src/purchase-status.test.tsx (2 tests) 3ms
 ✓ client/src/purchase-tasks-ui.test.tsx (2 tests) 9ms

 Test Files  3 passed (3)
      Tests  7 passed (7)
```

### Phase B 定向回归

命令：

```text
npm test -- --run server/test/purchase-tasks.test.ts server/test/purchased.test.ts client/src/purchase-status.test.tsx client/src/purchase-view.test.tsx client/src/purchase-tasks-ui.test.tsx
```

输出（退出码 0）：

```text
 Test Files  5 passed (5)
      Tests  10 passed (10)
```

### 全量验收

命令：`npm test`

输出（退出码 0）：

```text
 Test Files  16 passed (16)
      Tests  37 passed (37)
   Duration  3.13s (transform 644ms, setup 0ms, collect 5.40s, tests 8.68s, environment 3ms, prepare 1.51s)
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
✓ 69 modules transformed.
rendering chunks...
computing gzip size...
dist/index.html                   0.44 kB │ gzip:  0.34 kB
dist/assets/index-CSrtkZIG.css   10.41 kB │ gzip:  3.09 kB
dist/assets/index-DA2cqQsW.js   266.90 kB │ gzip: 82.69 kB
✓ built in 582ms
```

命令：`npm run acceptance`

输出（退出码 0；监听系统分配的随机端口，未使用 3000）：

```text
> lab-chemical-manager-v1@1.0.0 acceptance
> npm run build:server && node server/dist/server/scripts/acceptance.js

> lab-chemical-manager-v1@1.0.0 build:server
> tsc -p server/tsconfig.json

PASS health: empty in-memory SQLite database returns 200
PASS roles: five demo logins and server-side 403/200 authorization
PASS inventory/realtime: inbound, cross-owner move, invalid shelf, discard, two Socket.IO clients
PASS proxy inbound: pending scopes, authorization/version conflicts, atomic approval, reject/withdraw, realtime
PASS purchase state machine: normal/urgent/hazardous, approve/defer/revise/reject/withdraw, forbidden urgent approval
PASS purchase tasks: server summaries, role-specific approval/procurement queues, hazardous/nonhazardous routing
PASS dangerous-goods routing: normal/urgent catalogs and hazardous buyer queue
PASS purchased lifecycle: permissions/version conflicts, realtime, applicant outcomes, audit, active-queue removal, retained history
PASS preferences/audit: future category blocked while inventory and immutable public audit remain
ACCEPTANCE OK (26 audit entries verified)
```

命令：

```text
rg -o "采购待审批|药品待采购|我的审批|待采购|代入库|已采购" client/dist/assets -g '*.js' | Sort-Object -Unique
```

输出（退出码 0）：

```text
client/dist/assets\index-DA2cqQsW.js:采购待审批
client/dist/assets\index-DA2cqQsW.js:代入库
client/dist/assets\index-DA2cqQsW.js:待采购
client/dist/assets\index-DA2cqQsW.js:我的审批
client/dist/assets\index-DA2cqQsW.js:药品待采购
client/dist/assets\index-DA2cqQsW.js:已采购
```

命令：`git diff --check`

输出（退出码 0；无空白错误，仅有工作区 LF→CRLF 提示）：

```text
warning: in the working copy of 'client/src/App.tsx', LF will be replaced by CRLF the next time Git touches it
warning: in the working copy of 'client/src/notification-filter.test.tsx', LF will be replaced by CRLF the next time Git touches it
warning: in the working copy of 'client/src/notification-filter.ts', LF will be replaced by CRLF the next time Git touches it
warning: in the working copy of 'client/src/purchase-status.test.tsx', LF will be replaced by CRLF the next time Git touches it
warning: in the working copy of 'client/src/purchase-status.ts', LF will be replaced by CRLF the next time Git touches it
warning: in the working copy of 'client/src/purchase-view.test.tsx', LF will be replaced by CRLF the next time Git touches it
warning: in the working copy of 'client/src/purchase-view.ts', LF will be replaced by CRLF the next time Git touches it
warning: in the working copy of 'client/src/styles.css', LF will be replaced by CRLF the next time Git touches it
warning: in the working copy of 'client/src/types.ts', LF will be replaced by CRLF the next time Git touches it
warning: in the working copy of 'client/src/views.tsx', LF will be replaced by CRLF the next time Git touches it
warning: in the working copy of 'docs/TDD_EVIDENCE.md', LF will be replaced by CRLF the next time Git touches it
warning: in the working copy of 'server/scripts/acceptance.ts', LF will be replaced by CRLF the next time Git touches it
warning: in the working copy of 'server/src/database.ts', LF will be replaced by CRLF the next time Git touches it
warning: in the working copy of 'server/src/inventory.ts', LF will be replaced by CRLF the next time Git touches it
warning: in the working copy of 'server/src/purchases.ts', LF will be replaced by CRLF the next time Git touches it
warning: in the working copy of 'server/src/system.ts', LF will be replaced by CRLF the next time Git touches it
warning: in the working copy of 'server/test/inventory.test.ts', LF will be replaced by CRLF the next time Git touches it
warning: in the working copy of 'server/test/realtime.test.ts', LF will be replaced by CRLF the next time Git touches it
warning: in the working copy of 'shared/types.ts', LF will be replaced by CRLF the next time Git touches it
warning: in the working copy of 'shared/validation.ts', LF will be replaced by CRLF the next time Git touches it
```

## 2026-08-30 — V1.2 Phase A（代入库）

工作目录：`D:\hermes\worktrees\lab-chemical-manager-v1-2-proxy-procurement`

### Slice 1 — 调动层号 option / payload

RED 命令：

```text
npm test -- --run client/src/inventory-forms.test.tsx
```

RED 输出（退出码 1）：

```text
> lab-chemical-manager-v1@1.0.0 test
> vitest run --run client/src/inventory-forms.test.tsx

 RUN  v3.2.7 D:/hermes/worktrees/lab-chemical-manager-v1-2-proxy-procurement

 FAIL  client/src/inventory-forms.test.tsx [ client/src/inventory-forms.test.tsx ]
Error: Cannot find module './inventory-forms.js' imported from 'D:/hermes/worktrees/lab-chemical-manager-v1-2-proxy-procurement/client/src/inventory-forms.test.tsx'
 ❯ client/src/inventory-forms.test.tsx:3:1
      1| import { describe, expect, it } from 'vitest';
      2| import { renderToStaticMarkup } from 'react-dom/server';
      3| import { buildMovePayload, ShelfOptions } from './inventory-forms.js';
       | ^
      4|
      5| describe('inventory form payloads', () => {

Caused by: Error: Failed to load url ./inventory-forms.js (resolved id: ./inventory-forms.js) in D:/hermes/worktrees/lab-chemical-manager-v1-2-proxy-procurement/client/src/inventory-forms.test.tsx. Does the file exist?
 ❯ loadAndTransform node_modules/vite/dist/node/chunks/config.js:22739:33

 Test Files  1 failed (1)
      Tests  no tests
   Duration  484ms (transform 28ms, setup 0ms, collect 0ms, tests 0ms, environment 0ms, prepare 57ms)
```

GREEN 命令：

```text
npm test -- --run client/src/inventory-forms.test.tsx server/test/inventory.test.ts
```

GREEN 输出（退出码 0）：

```text
> lab-chemical-manager-v1@1.0.0 test
> vitest run --run client/src/inventory-forms.test.tsx server/test/inventory.test.ts

 RUN  v3.2.7 D:/hermes/worktrees/lab-chemical-manager-v1-2-proxy-procurement

 ✓ client/src/inventory-forms.test.tsx (2 tests) 7ms
 ✓ server/test/inventory.test.ts (2 tests) 642ms

 Test Files  2 passed (2)
      Tests  4 passed (4)
   Duration  1.35s (transform 89ms, setup 0ms, collect 302ms, tests 649ms, environment 0ms, prepare 122ms)
```

### Slice 2 — 普通入库锁定当前用户

RED 命令：

```text
npm test -- --run client/src/inventory-forms.test.tsx server/test/inventory.test.ts
```

RED 输出（退出码 1）：

```text
> lab-chemical-manager-v1@1.0.0 test
> vitest run --run client/src/inventory-forms.test.tsx server/test/inventory.test.ts

 RUN  v3.2.7 D:/hermes/worktrees/lab-chemical-manager-v1-2-proxy-procurement

 ❯ client/src/inventory-forms.test.tsx (3 tests | 1 failed) 11ms
   × direct inbound ownership > shows the current user as read-only and omits ownerId from the request payload 4ms
     → Element type is invalid: expected a string (for built-in components) or a class/function (for composite components) but got: undefined.
 ❯ server/test/inventory.test.ts (3 tests | 1 failed) 941ms
   × inventory vertical slice > locks direct inbound ownership to the authenticated user and rejects legacy owner overrides 289ms
     → expected 201 to be 400 // Object.is equality

 FAIL  server/test/inventory.test.ts > inventory vertical slice > locks direct inbound ownership to the authenticated user and rejects legacy owner overrides
AssertionError: expected 201 to be 400 // Object.is equality

- Expected
+ Received

- 400
+ 201

 ❯ server/test/inventory.test.ts:34:31

 Test Files  2 failed (2)
      Tests  2 failed | 4 passed (6)
   Duration  1.69s (transform 101ms, setup 0ms, collect 329ms, tests 952ms, environment 0ms, prepare 114ms)
```

GREEN 命令：

```text
npm test -- --run client/src/inventory-forms.test.tsx server/test/inventory.test.ts
```

GREEN 输出（退出码 0）：

```text
> lab-chemical-manager-v1@1.0.0 test
> vitest run --run client/src/inventory-forms.test.tsx server/test/inventory.test.ts

 RUN  v3.2.7 D:/hermes/worktrees/lab-chemical-manager-v1-2-proxy-procurement

 ✓ client/src/inventory-forms.test.tsx (3 tests) 8ms
 ✓ server/test/inventory.test.ts (3 tests) 939ms

 Test Files  2 passed (2)
      Tests  6 passed (6)
   Duration  1.67s (transform 109ms, setup 0ms, collect 327ms, tests 946ms, environment 1ms, prepare 118ms)
```

### Slice 3 — 代入库 create → pending → target approve

RED 命令：

```text
npm test -- --run server/test/inbound-requests.test.ts
```

RED 输出（退出码 1）：

```text
> lab-chemical-manager-v1@1.0.0 test
> vitest run --run server/test/inbound-requests.test.ts

 RUN  v3.2.7 D:/hermes/worktrees/lab-chemical-manager-v1-2-proxy-procurement

 ❯ server/test/inbound-requests.test.ts (2 tests | 2 failed) 663ms
   × proxy inbound create and approval > creates only a pending request scoped to requester/target, then atomically approves it into stock 381ms
     → expected 404 to be 201 // Object.is equality
   × proxy inbound create and approval > rejects self-targeting and disabled targets 281ms
     → expected 404 to be 400 // Object.is equality

 FAIL  server/test/inbound-requests.test.ts > proxy inbound create and approval > creates only a pending request scoped to requester/target, then atomically approves it into stock
AssertionError: expected 404 to be 201 // Object.is equality

- Expected
+ Received

- 201
+ 404

 ❯ server/test/inbound-requests.test.ts:25:36

 Test Files  1 failed (1)
      Tests  2 failed (2)
   Duration  1.38s (transform 80ms, setup 0ms, collect 250ms, tests 663ms, environment 0ms, prepare 61ms)
```

GREEN 命令：

```text
npm test -- --run server/test/inbound-requests.test.ts server/test/realtime.test.ts
```

GREEN 输出（退出码 0）：

```text
> lab-chemical-manager-v1@1.0.0 test
> vitest run --run server/test/inbound-requests.test.ts server/test/realtime.test.ts

 RUN  v3.2.7 D:/hermes/worktrees/lab-chemical-manager-v1-2-proxy-procurement

 ✓ server/test/realtime.test.ts (2 tests) 514ms
 ✓ server/test/inbound-requests.test.ts (2 tests) 849ms

 Test Files  2 passed (2)
      Tests  4 passed (4)
   Duration  1.57s (transform 108ms, setup 0ms, collect 527ms, tests 1.36s, environment 0ms, prepare 121ms)
```

### Slice 4 — reject 与 requester withdraw

RED 命令：

```text
npm test -- --run server/test/inbound-requests.test.ts
```

RED 输出（退出码 1）：

```text
> lab-chemical-manager-v1@1.0.0 test
> vitest run --run server/test/inbound-requests.test.ts

 RUN  v3.2.7 D:/hermes/worktrees/lab-chemical-manager-v1-2-proxy-procurement

 ❯ server/test/inbound-requests.test.ts (4 tests | 2 failed) 1474ms
   × proxy inbound rejection and withdrawal > lets only the target reject a pending request without creating stock, then notifies and audits 336ms
     → expected 400 to be 200 // Object.is equality
   × proxy inbound rejection and withdrawal > lets only the requester withdraw a pending request without creating stock, then notifies and audits 311ms
     → expected 404 to be 403 // Object.is equality

 FAIL  server/test/inbound-requests.test.ts > proxy inbound rejection and withdrawal > lets only the target reject a pending request without creating stock, then notifies and audits
AssertionError: expected 400 to be 200 // Object.is equality

- Expected
+ Received

- 200
+ 400

 ❯ server/test/inbound-requests.test.ts:81:37

 Test Files  1 failed (1)
      Tests  2 failed | 2 passed (4)
   Duration  2.20s (transform 91ms, setup 0ms, collect 265ms, tests 1.47s, environment 0ms, prepare 54ms)
```

GREEN 命令：

```text
npm test -- --run server/test/inbound-requests.test.ts
```

GREEN 输出（退出码 0）：

```text
> lab-chemical-manager-v1@1.0.0 test
> vitest run --run server/test/inbound-requests.test.ts

 RUN  v3.2.7 D:/hermes/worktrees/lab-chemical-manager-v1-2-proxy-procurement

 ✓ server/test/inbound-requests.test.ts (4 tests) 1580ms

 Test Files  1 passed (1)
      Tests  4 passed (4)
   Duration  2.30s (transform 89ms, setup 0ms, collect 265ms, tests 1.58s, environment 0ms, prepare 52ms)
```

### Slice 5 — 消息 / 库存前端代入库与 proxy_inbound

RED 命令：

```text
npm test -- --run client/src/inbound-requests-ui.test.tsx client/src/realtime-events.test.ts client/src/notification-filter.test.tsx
```

RED 输出（退出码 1）：

```text
> lab-chemical-manager-v1@1.0.0 test
> vitest run --run client/src/inbound-requests-ui.test.tsx client/src/realtime-events.test.ts client/src/notification-filter.test.tsx

 RUN  v3.2.7 D:/hermes/worktrees/lab-chemical-manager-v1-2-proxy-procurement

 FAIL  client/src/inbound-requests-ui.test.tsx [ client/src/inbound-requests-ui.test.tsx ]
Error: Cannot find module './inbound-requests-ui.js' imported from 'D:/hermes/worktrees/lab-chemical-manager-v1-2-proxy-procurement/client/src/inbound-requests-ui.test.tsx'
 ❯ client/src/inbound-requests-ui.test.tsx:3:1

 ❯ client/src/notification-filter.test.tsx (2 tests | 1 failed) 8ms
   × notification filters > provides all nine Chinese category labels and all read-state choices 6ms
     → expected proxy_inbound label "代入库", received undefined

 Test Files  2 failed (2)
      Tests  1 failed | 1 passed (2)
   Duration  537ms (transform 58ms, setup 0ms, collect 42ms, tests 8ms, environment 0ms, prepare 112ms)
```

注：初始 RED 命令中的 `client/src/realtime-events.test.ts` 不匹配仓库仅包含 `client/src/**/*.test.tsx` 的 Vitest 配置；随后将测试文件后缀更正为 `.tsx`，未改变测试内容。

GREEN / Phase A focused 命令：

```text
npm test -- --run client/src/inventory-forms.test.tsx client/src/inbound-requests-ui.test.tsx client/src/realtime-events.test.tsx client/src/notification-filter.test.tsx server/test/inventory.test.ts server/test/inbound-requests.test.ts server/test/realtime.test.ts
```

GREEN 输出（退出码 0）：

```text
> lab-chemical-manager-v1@1.0.0 test
> vitest run --run client/src/inventory-forms.test.tsx client/src/inbound-requests-ui.test.tsx client/src/realtime-events.test.tsx client/src/notification-filter.test.tsx server/test/inventory.test.ts server/test/inbound-requests.test.ts server/test/realtime.test.ts

 RUN  v3.2.7 D:/hermes/worktrees/lab-chemical-manager-v1-2-proxy-procurement

 ✓ client/src/realtime-events.test.tsx (1 test) 2ms
 ✓ client/src/notification-filter.test.tsx (2 tests) 2ms
 ✓ client/src/inventory-forms.test.tsx (3 tests) 8ms
 ✓ client/src/inbound-requests-ui.test.tsx (2 tests) 10ms
 ✓ server/test/realtime.test.ts (3 tests) 895ms
 ✓ server/test/inventory.test.ts (3 tests) 1066ms
 ✓ server/test/inbound-requests.test.ts (5 tests) 1976ms

 Test Files  7 passed (7)
      Tests  19 passed (19)
   Duration  2.92s (transform 319ms, setup 0ms, collect 1.67s, tests 3.96s, environment 1ms, prepare 538ms)
```

### Phase A 全量验收

```text
$ npm test
Test Files  13 passed (13)
     Tests  32 passed (32)
  Duration  2.97s (transform 709ms, setup 0ms, collect 3.70s, tests 6.54s, environment 2ms, prepare 1.31s)

$ npm run lint
> tsc -p server/tsconfig.json --noEmit && tsc -p client/tsconfig.json --noEmit
退出码 0

$ npm run build
> npm run build:server && npm run build:client
✓ 68 modules transformed.
dist/index.html                   0.44 kB │ gzip:  0.34 kB
dist/assets/index-CjrCWBWc.css   10.10 kB │ gzip:  3.02 kB
dist/assets/index-CFqTV0HN.js   265.65 kB │ gzip: 82.33 kB
✓ built in 587ms
退出码 0

$ npm run acceptance
PASS health: empty in-memory SQLite database returns 200
PASS roles: five demo logins and server-side 403/200 authorization
PASS inventory/realtime: inbound, cross-owner move, invalid shelf, discard, two Socket.IO clients
PASS proxy inbound: pending scopes, authorization/version conflicts, atomic approval, reject/withdraw, realtime
PASS purchase state machine: normal/urgent/hazardous, approve/defer/revise/reject/withdraw, forbidden urgent approval
PASS dangerous-goods routing: normal/urgent catalogs and hazardous buyer queue
PASS preferences/audit: future category blocked while inventory and immutable public audit remain
ACCEPTANCE OK (23 audit entries verified)
退出码 0

$ git diff --check
退出码 0；无空白错误，仅输出工作区 LF→CRLF 提示。

$ rg -o "待我确认的代入库|我发起的代入库|提交代入库申请|代入库申请已同意|代入库" client/dist/assets/index-*.js | Sort-Object -Unique
代入库
待我确认的代入库
提交代入库申请
我发起的代入库
退出码 0
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
