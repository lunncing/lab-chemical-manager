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

## V1.3.0 注册、采购筛选与展示精简（2026-08-30）

工作树：`D:/hermes/worktrees/lab-chemical-manager-v1-3-registration`

基线检查（改动前）：

```text
$ npm test
Test Files  16 passed (16)
     Tests  46 passed (46)
  Duration  4.09s (transform 1.57s, setup 0ms, collect 8.64s, tests 11.51s, environment 4ms, prepare 2.23s)
退出码 0
```

### Slice 1 — AuditView 精简与 PurchaseTable 提交日期

RED 命令：

```text
npm test -- --run client/src/audit-view.test.tsx client/src/purchase-tasks-ui.test.tsx server/test/routing.test.ts
```

RED 输出（退出码 1）：

```text
❯ client/src/purchase-tasks-ui.test.tsx (5 tests | 1 failed) 34ms
  × purchase task UI > shows a Chinese submission date after applicant in every table mode and safely handles invalid values 20ms
    → (0 , formatPurchaseCreatedAt) is not a function
❯ client/src/audit-view.test.tsx (1 test | 1 failed) 9ms
  × audit log display > keeps the public evidence summary but omits structured details from production DOM 8ms
    → Element type is invalid: expected a string (for built-in components) or a class/function (for composite components) but got: undefined.
❯ server/test/routing.test.ts (2 tests | 1 failed) 856ms
  × catalog and notification routing > notification category switches block only future messages, not audit or business data 313ms
    → expected { cabinet: 'A', shelf: 3, ownerId: 4 } to match object { Object (name, cabinet, ...) }

Test Files  3 failed (3)
     Tests  3 failed | 5 passed (8)
  Duration  1.88s (transform 293ms, setup 0ms, collect 738ms, tests 899ms, environment 1ms, prepare 280ms)
```

注：服务端 RED 是测试预期过度指定；现有审计详情按设计保存 `{ cabinet, shelf, ownerId }`，药品名已在摘要中。修正该断言后，仍由两个缺失的前端能力维持 RED；未为通过测试删除或停止写入服务端 `details_json`。

GREEN 命令及输出（退出码 0）：

```text
$ npm test -- --run client/src/audit-view.test.tsx client/src/purchase-tasks-ui.test.tsx server/test/routing.test.ts
✓ client/src/purchase-tasks-ui.test.tsx (5 tests) 42ms
✓ client/src/audit-view.test.tsx (1 test) 31ms
✓ server/test/routing.test.ts (2 tests) 916ms
Test Files  3 passed (3)
     Tests  8 passed (8)
  Duration  2.04s (transform 289ms, setup 0ms, collect 858ms, tests 989ms, environment 1ms, prepare 295ms)
```

### Slice 2 — 集中角色标签与干净登录页

RED 命令及输出（退出码 1）：

```text
$ npm test -- --run client/src/role-labels.test.tsx client/src/App.test.tsx client/src/purchase-status.test.tsx
FAIL  client/src/role-labels.test.tsx
Error: Cannot find module './role-labels.js'
❯ client/src/App.test.tsx (6 tests | 1 failed) 14ms
  × front-end critical behavior > renders a clean login form with empty credentials and no demo guidance 6ms
    → Element type is invalid
❯ client/src/purchase-status.test.tsx (2 tests | 1 failed) 13ms
  × purchase status labels > maps all seven API status values to Chinese UI labels 11ms
    - "label": "待审批与普通采购人审批"
    + "label": "待普通管理员审批"
Test Files  3 failed (3)
     Tests  2 failed | 6 passed (8)
  Duration  1.05s (transform 190ms, setup 0ms, collect 339ms, tests 27ms, environment 1ms, prepare 311ms)
```

GREEN 命令及输出（退出码 0）：

```text
$ npm test -- --run client/src/role-labels.test.tsx client/src/App.test.tsx client/src/purchase-status.test.tsx
✓ client/src/purchase-status.test.tsx (2 tests) 3ms
✓ client/src/role-labels.test.tsx (2 tests) 7ms
✓ client/src/App.test.tsx (6 tests) 13ms
Test Files  3 passed (3)
     Tests  10 passed (10)
  Duration  838ms (transform 153ms, setup 0ms, collect 407ms, tests 23ms, environment 1ms, prepare 256ms)
```

### Slice 3 — 严格普通成员注册、事务会话与前端自动登录

RED 命令及输出（退出码 1）：

```text
$ npm test -- --run server/test/registration.test.ts client/src/App.test.tsx
❯ client/src/App.test.tsx (8 tests | 3 failed) 21ms
  × front-end critical behavior > renders a clean login form with empty credentials and no demo guidance 12ms
    → expected login markup to contain '注册'
  × front-end critical behavior > renders strict member registration fields without any role control 2ms
    → Element type is invalid
  × front-end critical behavior > posts only registration fields and returns the user used for automatic login 1ms
    → (0 , registerAccount) is not a function
❯ server/test/registration.test.ts (4 tests | 4 failed) 851ms
  × ... atomically creates a hashed member, session, public audit, notification, and compatible cookie
    → expected 401 to be 201
  × ... honors super-admin account notification preferences
    → expected 401 to be 201
  × ... rejects confirmation mismatch, role injection, short passwords, and invalid usernames without side effects
    → expected 401 to be 400
  × ... returns a Chinese 409 conflict for a duplicate username
    → expected 401 to be 201
Test Files  2 failed (2)
     Tests  7 failed | 5 passed (12)
  Duration  1.71s (transform 212ms, setup 0ms, collect 567ms, tests 872ms, environment 0ms, prepare 147ms)
```

GREEN 命令及输出（退出码 0）：

```text
$ npm test -- --run server/test/registration.test.ts client/src/App.test.tsx
✓ client/src/App.test.tsx (8 tests) 16ms
✓ server/test/registration.test.ts (4 tests) 1080ms
  ✓ ... atomically creates a hashed member, session, public audit, notification, and compatible cookie 309ms
Test Files  2 passed (2)
     Tests  12 passed (12)
  Duration  1.90s (transform 200ms, setup 0ms, collect 523ms, tests 1.10s, environment 0ms, prepare 153ms)
```

### Slice 4 — 待采购 requestType 服务端筛选与前端保持筛选

RED 命令及输出（退出码 1）：

```text
$ npm test -- --run server/test/purchase-tasks.test.ts client/src/purchase-view.test.tsx client/src/purchase-tasks-ui.test.tsx
❯ client/src/purchase-view.test.tsx (5 tests | 1 failed) 7ms
  × ... builds exact procurement filter paths without changing the approval path
    → (0 , procurementTaskPath) is not a function
❯ client/src/purchase-tasks-ui.test.tsx (6 tests | 1 failed) 36ms
  × ... renders the purchase-type filter only for procurement tasks
    → Element type is invalid
❯ server/test/purchase-tasks.test.ts (2 tests | 1 failed) 1499ms
  × ... filters procurement tasks by a strictly validated bound request type 716ms
    → expected [ 1, 2 ] to deeply equal [ 1 ]
Test Files  3 failed (3)
     Tests  3 failed | 10 passed (13)
  Duration  2.49s (transform 206ms, setup 0ms, collect 565ms, tests 1.54s, environment 1ms, prepare 251ms)
```

GREEN 命令及输出（退出码 0）：

```text
$ npm test -- --run server/test/purchase-tasks.test.ts client/src/purchase-view.test.tsx client/src/purchase-tasks-ui.test.tsx
✓ client/src/purchase-view.test.tsx (5 tests) 4ms
✓ client/src/purchase-tasks-ui.test.tsx (6 tests) 51ms
✓ server/test/purchase-tasks.test.ts (2 tests) 1864ms
Test Files  3 passed (3)
     Tests  13 passed (13)
  Duration  3.42s (transform 449ms, setup 0ms, collect 975ms, tests 1.92s, environment 0ms, prepare 324ms)
```

实现检查：`PurchaseTaskView` 的 `requestType` 是组件状态；请求路径由该状态计算，加载 effect 依赖 `[path, revision]`。因此 realtime revision 不会清空筛选，并会用当前筛选重新请求。

### Slice 5 — 普通/加急目录危险品隔离与完成权限矩阵

RED 命令及输出（退出码 1）：

```text
$ npm test -- --run server/test/routing.test.ts server/test/purchased.test.ts
❯ server/test/routing.test.ts (2 tests | 1 failed) 1092ms
  × catalog and notification routing > routes approved normal, urgent, and hazardous requests to the correct catalogs 748ms
    → expected [ 3, 1 ] to not include 3
✓ server/test/purchased.test.ts (2 tests) 1521ms
Test Files  1 failed | 1 passed (2)
     Tests  1 failed | 3 passed (4)
  Duration  2.58s (transform 200ms, setup 0ms, collect 780ms, tests 2.61s, environment 0ms, prepare 202ms)
```

GREEN 命令及输出（退出码 0）：

```text
$ npm test -- --run server/test/routing.test.ts server/test/purchased.test.ts
✓ server/test/routing.test.ts (2 tests) 864ms
✓ server/test/purchased.test.ts (2 tests) 1127ms
Test Files  2 passed (2)
     Tests  4 passed (4)
  Duration  1.86s (transform 118ms, setup 0ms, collect 565ms, tests 1.99s, environment 0ms, prepare 130ms)
```

### Slice 6 — acceptance 扩展

RED 命令及输出（退出码 1；扩展验收流程尚缺注册支持 helper）：

```text
$ npm run acceptance
> tsc -p server/tsconfig.json
server/scripts/acceptance.ts(48,28): error TS2552: Cannot find name 'register'. Did you mean 'registered'?
server/scripts/acceptance.ts(55,23): error TS2552: Cannot find name 'register'. Did you mean 'registered'?
server/scripts/acceptance.ts(56,23): error TS2552: Cannot find name 'register'. Did you mean 'registered'?
```

GREEN 命令及输出（退出码 0）：

```text
$ npm run acceptance
PASS health: empty in-memory SQLite database returns 200
PASS roles: five demo logins and server-side 403/200 authorization
PASS registration: strict member-only hashed account, transactional session/audit/notification, cookie auto-login
PASS inventory/realtime: inbound, cross-owner move, invalid shelf, discard, two Socket.IO clients
PASS proxy inbound: pending scopes, authorization/version conflicts, atomic approval, reject/withdraw, realtime
PASS purchase state machine: normal/urgent/hazardous, approve/defer/revise/reject/withdraw, forbidden urgent approval
PASS purchase tasks: server summaries, role-specific approval/procurement queues, hazardous/nonhazardous routing
PASS dangerous-goods routing: normal/urgent catalogs and hazardous buyer queue
PASS purchased lifecycle: permissions/version conflicts, realtime, applicant outcomes, audit, active-queue removal, retained history
PASS preferences/audit: future category blocked while inventory and immutable public audit remain
ACCEPTANCE OK (30 audit entries verified)
```

### V1.3.0 最终验收

```text
$ npm test
Test Files  19 passed (19)
     Tests  60 passed (60)
  Duration  3.08s (transform 923ms, setup 0ms, collect 6.24s, tests 10.90s, environment 3ms, prepare 1.79s)
退出码 0

$ npm run lint
> tsc -p server/tsconfig.json --noEmit && tsc -p client/tsconfig.json --noEmit
退出码 0

$ npm run build
> npm run build:server && npm run build:client
✓ 70 modules transformed.
dist/index.html                   0.44 kB │ gzip:  0.34 kB
dist/assets/index-BawmvEiZ.css   10.55 kB │ gzip:  3.10 kB
dist/assets/index-BzSNXQ80.js   271.56 kB │ gzip: 83.69 kB
✓ built in 622ms
退出码 0

$ npm run acceptance
PASS registration: strict member-only hashed account, transactional session/audit/notification, cookie auto-login
PASS purchase tasks: server summaries, role-specific approval/procurement queues, hazardous/nonhazardous routing
PASS dangerous-goods routing: normal/urgent catalogs and hazardous buyer queue
ACCEPTANCE OK (30 audit entries verified)
退出码 0

$ git diff --check
退出码 0；无空白错误。输出仅为工作区文件的 LF→CRLF 提示。
```

生产 bundle 精确检查：

```text
BUNDLE index-BzSNXQ80.js
REQUIRED [注册] PRESENT
REQUIRED [审批与普通采购人] PRESENT
REQUIRED [提交日期] PRESENT
REQUIRED [采购类型] PRESENT
FORBIDDEN [首测演示凭据] ABSENT
FORBIDDEN [统一密码] ABSENT
FORBIDDEN [Demo1234!] ABSENT
FORBIDDEN [结构化详情] ABSENT
FORBIDDEN [普通管理员] ABSENT
退出码 0
```

范围核对：`git diff -- server/src/database.ts package.json package-lock.json` 无输出；没有数据库 schema 改动、依赖改动或 lockfile 改动。所有 HTTP 测试和 acceptance 使用系统分配的临时端口（`listen(0)`），未访问或修改端口 3000。

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

## V1.3.0 最终追加记录（2026-08-30）

详细的六个垂直切片 RED→GREEN 原始失败签名和定向 GREEN 结果已记录在本文档上方的“V1.3.0 注册、采购筛选与展示精简”章节。最终命令证据如下：

```text
$ npm test
Test Files  19 passed (19)
     Tests  60 passed (60)
  Duration  3.08s (transform 923ms, setup 0ms, collect 6.24s, tests 10.90s, environment 3ms, prepare 1.79s)
退出码 0

$ npm run lint
> tsc -p server/tsconfig.json --noEmit && tsc -p client/tsconfig.json --noEmit
退出码 0

$ npm run build
✓ 70 modules transformed.
dist/index.html                   0.44 kB │ gzip:  0.34 kB
dist/assets/index-BawmvEiZ.css   10.55 kB │ gzip:  3.10 kB
dist/assets/index-BzSNXQ80.js   271.56 kB │ gzip: 83.69 kB
✓ built in 622ms
退出码 0

$ npm run acceptance
PASS registration: strict member-only hashed account, transactional session/audit/notification, cookie auto-login
PASS purchase tasks: server summaries, role-specific approval/procurement queues, hazardous/nonhazardous routing
PASS dangerous-goods routing: normal/urgent catalogs and hazardous buyer queue
ACCEPTANCE OK (30 audit entries verified)
退出码 0

$ git diff --check
退出码 0；无空白错误，仅有 LF→CRLF 提示。

BUNDLE index-BzSNXQ80.js
REQUIRED [注册] PRESENT
REQUIRED [审批与普通采购人] PRESENT
REQUIRED [提交日期] PRESENT
REQUIRED [采购类型] PRESENT
FORBIDDEN [首测演示凭据] ABSENT
FORBIDDEN [统一密码] ABSENT
FORBIDDEN [Demo1234!] ABSENT
FORBIDDEN [结构化详情] ABSENT
FORBIDDEN [普通管理员] ABSENT
退出码 0
```

## 2026-08-30 — V1.2.1 信息架构 / 导航调整

工作目录：`D:\hermes\worktrees\lab-chemical-manager-v1-2-1-nav`

基线：`8c680d27d5d406f89583426bc25372cb75afed08`

分支：`fix/task-navigation-proxy-buttons-v1.2.1`

开始前 `git status --short` 无输出；基线 `npm test` 为 16 个测试文件、37 项测试全部通过。

### Slice 1 — 一级任务导航角色矩阵 / count / 安全回退

先仅增加角色导航测试，再执行 RED：

```text
npm test -- --run client/src/App.test.tsx
```

RED 输出（退出码 1）：

```text
RUN  v3.2.7 D:/hermes/worktrees/lab-chemical-manager-v1-2-1-nav

❯ client/src/App.test.tsx (5 tests | 3 failed) 14ms
  ✓ front-end critical behavior > renders two cabinets with five ordered, clickable shelves and chemical entries 7ms
  ✓ front-end critical behavior > maps role affordances to the same approval model used by the server 0ms
  × role-filtered primary navigation > omits task navigation DOM entirely for members 4ms
    → Element type is invalid: expected a string (for built-in components) or a class/function (for composite components) but got: undefined.
  × role-filtered primary navigation > shows only procurement to hazardous buyers and both counted tasks to administrators 0ms
    → Element type is invalid: expected a string (for built-in components) or a class/function (for composite components) but got: undefined.
  × role-filtered primary navigation > uses the server summary path, refreshes on purchase revisions, and falls back from forbidden views 2ms
    → expected undefined to be '/purchases/tasks/summary' // Object.is equality

Test Files  1 failed (1)
     Tests  3 failed | 2 passed (5)
Duration  675ms
```

实现 App 级 summary、角色过滤导航和安全 view 后执行 GREEN：

```text
npm test -- --run client/src/App.test.tsx
```

GREEN 输出（退出码 0）：

```text
RUN  v3.2.7 D:/hermes/worktrees/lab-chemical-manager-v1-2-1-nav

✓ client/src/App.test.tsx (5 tests) 10ms

Test Files  1 passed (1)
     Tests  5 passed (5)
Duration  661ms
```

### Slice 2 — 采购表 capability / 申请 tabs / 一级任务 endpoint

先仅修改采购视图与表格测试，再执行 RED：

```text
npm test -- --run client/src/purchase-view.test.tsx client/src/purchase-tasks-ui.test.tsx
```

RED 输出（退出码 1）：

```text
RUN  v3.2.7 D:/hermes/worktrees/lab-chemical-manager-v1-2-1-nav

❯ client/src/purchase-view.test.tsx (4 tests | 2 failed) 7ms
  × purchase view modes > keeps task queues out of purchase-request tabs and marks the current catalog tab as pressed 5ms
    → expected [ 'all', 'mine', 'approvals', …(3) ] to deeply equal [ 'all', 'mine', …(2) ]
  × purchase view modes > defines top-level task pages with their exact server endpoints and Chinese empty states 0ms
    → (0 , purchaseTaskDefinition) is not a function
❯ client/src/purchase-tasks-ui.test.tsx (4 tests | 2 failed) 10ms
  × purchase task UI > maps each view to an exact operation capability set 3ms
    → (0 , purchaseTableCapabilities) is not a function
  × purchase task UI > omits the operation column for all/catalog and renders only mode-specific actions elsewhere 2ms
    → Element type is invalid: expected a string (for built-in components) or a class/function (for composite components) but got: undefined.

Test Files  2 failed (2)
     Tests  4 failed | 4 passed (8)
Duration  554ms
```

首次实现后有一项测试把状态文字“已通过”误判成“通过”操作按钮；仅将该测试收窄为匹配 `<button>通过</button>`，未修改生产行为。随后执行聚焦 GREEN：

```text
npm test -- --run client/src/purchase-view.test.tsx client/src/purchase-tasks-ui.test.tsx client/src/App.test.tsx
```

GREEN 输出（退出码 0）：

```text
RUN  v3.2.7 D:/hermes/worktrees/lab-chemical-manager-v1-2-1-nav

✓ client/src/purchase-view.test.tsx (4 tests) 4ms
✓ client/src/purchase-tasks-ui.test.tsx (4 tests) 11ms
✓ client/src/App.test.tsx (5 tests) 10ms

Test Files  3 passed (3)
     Tests  13 passed (13)
Duration  696ms
```

该 slice 后 `npm run lint` 退出码 0。

### Slice 3 — 代入库顶部 launcher / 单队列 modal / 柜体后不常驻

先仅增加 pending count、按钮顺序/aria、modal scope/action 与 Inventory DOM placement 测试，再执行 RED：

```text
npm test -- --run client/src/inbound-requests-ui.test.tsx
```

RED 输出（退出码 1）：

```text
RUN  v3.2.7 D:/hermes/worktrees/lab-chemical-manager-v1-2-1-nav

❯ client/src/inbound-requests-ui.test.tsx (5 tests | 3 failed) 20ms
  × proxy inbound front-end controls > counts only pending requests and renders the three launchers in the required accessible order 3ms
    → (0 , pendingInboundCount) is not a function
  × proxy inbound front-end controls > uses an accessible modal with only the selected queue and its permitted actions 2ms
    → Element type is invalid: expected a string (for built-in components) or a class/function (for composite components) but got: undefined.
  × proxy inbound front-end controls > places launchers before search and cabinets without a permanently rendered queue 6ms
    → expected InventoryView markup not to contain 'proxy-request-list'

Test Files  1 failed (1)
     Tests  3 failed | 2 passed (5)
Duration  651ms
```

实现顶部 launcher、pending count 和使用现有 `Modal` 的单队列弹层后执行 GREEN：

```text
npm test -- --run client/src/inbound-requests-ui.test.tsx client/src/App.test.tsx
```

GREEN 输出（退出码 0）：

```text
RUN  v3.2.7 D:/hermes/worktrees/lab-chemical-manager-v1-2-1-nav

✓ client/src/inbound-requests-ui.test.tsx (5 tests) 13ms
✓ client/src/App.test.tsx (5 tests) 10ms

Test Files  2 passed (2)
     Tests  10 passed (10)
Duration  681ms
```

### V1.2.1 全量验收

`npm test`（退出码 0）：

```text
Test Files  16 passed (16)
     Tests  46 passed (46)
Duration  3.18s (transform 836ms, setup 0ms, collect 6.11s, tests 8.68s, environment 3ms, prepare 1.57s)
```

即保留原 37 项并新增 9 项测试。

`npm run lint`（退出码 0）：

```text
> lab-chemical-manager-v1@1.0.0 lint
> tsc -p server/tsconfig.json --noEmit && tsc -p client/tsconfig.json --noEmit
```

`npm run build`（退出码 0）：

```text
> lab-chemical-manager-v1@1.0.0 build
> npm run build:server && npm run build:client

> lab-chemical-manager-v1@1.0.0 build:server
> tsc -p server/tsconfig.json

> lab-chemical-manager-v1@1.0.0 build:client
> vite build --config client/vite.config.ts

vite v7.3.6 building client environment for production...
✓ 69 modules transformed.
dist/index.html                   0.44 kB │ gzip:  0.34 kB
dist/assets/index-CC9pqaf-.css   10.42 kB │ gzip:  3.08 kB
dist/assets/index-CHW8wuSW.js   269.25 kB │ gzip: 83.30 kB
✓ built in 610ms
```

`npm run acceptance`（退出码 0）：

```text
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

生产 bundle 标签检查（退出码 0）：

```text
PASS 待审批
PASS 待采购
PASS 待我确认的代入库
PASS 我发起的代入库
PASS 我的审批 absent
```

`git diff --check` 退出码 0、无空白错误；仅报告允许范围内已修改文件的 LF→CRLF 工作区提示。未修改 server、database、shared API enum、package/lockfile、认证或用户 SQLite 数据；未 commit。

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

## V1.3.0 evidence — appended final verification

```text
npm test: exit 0; Test Files 19 passed (19); Tests 60 passed (60)
npm run lint: exit 0
npm run build: exit 0; client bundle index-BzSNXQ80.js
npm run acceptance: exit 0; ACCEPTANCE OK (30 audit entries verified)
git diff --check: exit 0; no whitespace errors (LF→CRLF notices only)
bundle required: 注册 / 审批与普通采购人 / 提交日期 / 采购类型 — PRESENT
bundle forbidden: 首测演示凭据 / 统一密码 / Demo1234! / 结构化详情 / 普通管理员 — ABSENT
```

## 2026-08-30 — V1.4.0 普通采购周归档

工作目录：`D:\hermes\worktrees\lab-chemical-manager-v1-4-weekly-archives`

### Slice 1 — Asia/Shanghai 周边界与严格日期函数

RED 命令：`npm test -- --run server/test/purchase-weeks.test.ts`

```text
FAIL  server/test/purchase-weeks.test.ts [ server/test/purchase-weeks.test.ts ]
Error: Cannot find module '../src/purchase-weeks.js'
Test Files  1 failed (1)
     Tests  no tests
退出码 1
```

GREEN 命令：`npm test -- --run server/test/purchase-weeks.test.ts`

```text
✓ server/test/purchase-weeks.test.ts (4 tests) 4ms
Test Files  1 passed (1)
     Tests  4 passed (4)
退出码 0
```

### Slice 2 — additive table 与 V1.3 幂等回填

RED 命令：`npm test -- --run server/test/database-weekly-archives.test.ts`

```text
❯ server/test/database-weekly-archives.test.ts (1 test | 1 failed) 378ms
  × weekly purchase archive migration > adds only the archive table and idempotently backfills eligible V1.3 rows without changing legacy data 378ms
    → Cannot read properties of undefined (reading 'sql')
Test Files  1 failed (1)
     Tests  1 failed (1)
退出码 1
```

GREEN 命令：`npm test -- --run server/test/database-weekly-archives.test.ts`

```text
✓ server/test/database-weekly-archives.test.ts (1 test) 429ms
  ✓ weekly purchase archive migration > adds only the archive table and idempotently backfills eligible V1.3 rows without changing legacy data 428ms
Test Files  1 passed (1)
     Tests  1 passed (1)
退出码 0
```

### Slice 3 — 审批事务内原子归档

RED 命令：`npm test -- --run server/test/purchase-archive-membership.test.ts`

```text
❯ server/test/purchase-archive-membership.test.ts (2 tests | 2 failed) 716ms
  × approval-time weekly archive membership > archives only approved normal nonhazardous requests using their successful decision time 424ms
    → expected [] to deeply equal [ { purchase_id: 1, …(2) } ]
  × approval-time weekly archive membership > rolls back approval, audit, and notifications when archive insertion fails 291ms
    → expected 200 to be 500 // Object.is equality
Test Files  1 failed (1)
     Tests  2 failed (2)
退出码 1
```

GREEN 命令：`npm test -- --run server/test/purchase-archive-membership.test.ts`

```text
✓ server/test/purchase-archive-membership.test.ts (2 tests) 794ms
  ✓ approval-time weekly archive membership > archives only approved normal nonhazardous requests using their successful decision time 491ms
  ✓ approval-time weekly archive membership > rolls back approval, audit, and notifications when archive insertion fails 302ms
Test Files  1 passed (1)
     Tests  2 passed (2)
退出码 0
```

### Slice 4–5 — weeks API 与 current/specified normal catalog

RED 命令：`npm test -- --run server/test/purchase-weekly-api.test.ts`

```text
❯ server/test/purchase-weekly-api.test.ts (4 tests | 4 failed) 1161ms
  × weekly normal purchase catalog APIs > always returns an empty current week and permits only normal/super admins 397ms
    → expected 404 to be 403 // Object.is equality
  × weekly normal purchase catalog APIs > returns descending archived weeks with approved and purchased statistics 237ms
    → Unexpected token '<', "<!DOCTYPE "... is not valid JSON
  × weekly normal purchase catalog APIs > serves current or specified archived membership, retaining purchased and excluding urgent/hazardous rows 298ms
    → expected undefined to deeply equal { weekStart: '2026-08-24', …(2) }
  × weekly normal purchase catalog APIs > rejects non-Mondays, impossible/loose dates, and repeated week queries with a Chinese 400 229ms
    → expected 200 to be 400 // Object.is equality
Test Files  1 failed (1)
     Tests  4 failed (4)
退出码 1
```

GREEN 命令：`npm test -- --run server/test/purchase-weekly-api.test.ts`

```text
✓ server/test/purchase-weekly-api.test.ts (4 tests) 1293ms
Test Files  1 passed (1)
     Tests  4 passed (4)
退出码 0
```

### Slice 6 — 前端周选择器、统计与 tab 可见性

RED 命令：`npm test -- --run client/src/purchase-weekly-ui.test.tsx`

```text
FAIL  client/src/purchase-weekly-ui.test.tsx [ client/src/purchase-weekly-ui.test.tsx ]
Error: Cannot find module './purchase-weekly-ui.js'
Test Files  1 failed (1)
     Tests  no tests
退出码 1
```

GREEN 命令：`npm test -- --run client/src/purchase-weekly-ui.test.tsx client/src/purchase-view.test.tsx client/src/purchase-tasks-ui.test.tsx`

```text
✓ client/src/purchase-view.test.tsx (5 tests) 4ms
✓ client/src/purchase-weekly-ui.test.tsx (4 tests) 8ms
✓ client/src/purchase-tasks-ui.test.tsx (6 tests) 29ms
Test Files  3 passed (3)
     Tests  15 passed (15)
退出码 0
```

### Slice 7 — acceptance 跨周与 purchased retention

RED 命令：`npm run acceptance`

```text
PASS dangerous-goods routing: normal/urgent catalogs and hazardous buyer queue
AssertionError [ERR_ASSERTION]: Expected values to be strictly equal:

true !== false

actual: true
expected: false
退出码 1
```

额外 purchased-retention RED 命令：`npm test -- --run server/test/purchased.test.ts`

```text
❯ server/test/purchased.test.ts (2 tests | 1 failed) 1089ms
  × approved to purchased transition > routes approval tasks, broadcasts completion, notifies the applicant, audits it, and removes it only from active queues 430ms
    → expected [ 1 ] to not include 1
Test Files  1 failed (1)
     Tests  1 failed | 1 passed (2)
退出码 1
```

GREEN 命令：`npm run acceptance`

```text
PASS health: empty in-memory SQLite database returns 200
PASS roles: five demo logins and server-side 403/200 authorization
PASS registration: strict member-only hashed account, transactional session/audit/notification, cookie auto-login
PASS inventory/realtime: inbound, cross-owner move, invalid shelf, discard, two Socket.IO clients
PASS proxy inbound: pending scopes, authorization/version conflicts, atomic approval, reject/withdraw, realtime
PASS purchase state machine: normal/urgent/hazardous, approve/defer/revise/reject/withdraw, forbidden urgent approval
PASS purchase tasks: server summaries, role-specific approval/procurement queues, hazardous/nonhazardous routing
PASS dangerous-goods routing: normal/urgent catalogs and hazardous buyer queue
PASS weekly archive rollover: approval membership, current empty week, descending historical statistics
PASS purchased lifecycle: active-queue removal plus cross-week archive and purchased retention
PASS preferences/audit: future category blocked while inventory and immutable public audit remain
ACCEPTANCE OK (30 audit entries verified)
退出码 0
```

### V1.3 正式数据库副本升级

命令：

```text
npm run build:server
node server/dist/server/scripts/verify-weekly-upgrade.js D:\hermes\worktrees\lab-chemical-manager-v1\data\lab-chemical-manager.sqlite
```

输出（源文件只读复制到系统临时目录，升级与二次启动仅作用于副本）：

```text
PASS V1.3 production database copy: 9 legacy tables unchanged; 2 eligible rows backfilled; second open idempotent
退出码 0
```

### V1.4.0 最终验收

```text
npm test: 退出码 0；Test Files 24 passed (24)；Tests 75 passed (75)
npm run lint: 退出码 0
npm run build: 退出码 0；71 modules transformed；client bundle index-CQ0RDwaG.js / index-YyCuLsdp.css
npm run acceptance: 退出码 0；ACCEPTANCE OK (30 audit entries verified)
git diff --check: 退出码 0；无空白错误（仅 LF→CRLF 提示）
package.json / package-lock.json diff: 无输出
bundle required: 采购周次 / 本周 / 历史 — PRESENT
```

## 2026-08-30 — V1.5.0 单层酸柜 C

工作目录：`D:\hermes\worktrees\lab-chemical-manager-v1-5-acid-cabinet`

### Slice 1 — shared cabinet metadata/rules

RED：`npm test -- --run server/test/cabinets.test.ts`

```text
FAIL server/test/cabinets.test.ts
Error: Cannot find module '../../shared/cabinets.js'
Test Files 1 failed (1); Tests no tests; 退出码 1
```

GREEN：`npm test -- --run server/test/cabinets.test.ts`

```text
✓ server/test/cabinets.test.ts (2 tests)
Test Files 1 passed (1); Tests 2 passed (2); 退出码 0
```

### Slice 2 — strict Zod direct/move/proxy/query validation

RED：`npm test -- --run server/test/cabinet-validation.test.ts`

```text
❯ server/test/cabinet-validation.test.ts (2 tests | 2 failed)
expected false to be true
Cannot read properties of undefined (reading 'parse')
Test Files 1 failed (1); Tests 2 failed (2); 退出码 1
```

GREEN：`npm test -- --run server/test/cabinet-validation.test.ts server/test/cabinets.test.ts`

```text
✓ server/test/cabinets.test.ts (2 tests)
✓ server/test/cabinet-validation.test.ts (2 tests)
Test Files 2 passed (2); Tests 4 passed (4); 退出码 0
```

### Slice 3 — V1.4 file SQLite rebuild/rollback/idempotence

RED：`npm test -- --run server/test/database-acid-cabinet.test.ts`

```text
FAIL server/test/database-acid-cabinet.test.ts
Error: Cannot find module '../src/cabinet-migration.js'
Test Files 1 failed (1); Tests no tests; 退出码 1
```

GREEN：`npm test -- --run server/test/database-acid-cabinet.test.ts`

```text
✓ server/test/database-acid-cabinet.test.ts (2 tests)
Test Files 1 passed (1); Tests 2 passed (2); 退出码 0
```

覆盖：10 张业务表逐表 row-count/JSON-SHA；approved `chemical_id` FK；旧 id/version/timestamp；必需索引与额外自定义索引；C1/C2 CHECK；二次打开 schema/行幂等；故障 FK 的 ROLLBACK、foreign_keys 恢复和临时表清理。

### Slice 4 — API C direct/move/proxy

RED：`npm test -- --run server/test/inventory.test.ts server/test/inbound-requests.test.ts`

```text
❯ server/test/inventory.test.ts (4 tests | 1 failed)
  expected 400 to be 200
❯ server/test/inbound-requests.test.ts (6 tests | 1 failed)
  expected false to be true
Test Files 2 failed (2); Tests 2 failed | 8 passed (10); 退出码 1
```

GREEN：`npm test -- --run server/test/inventory.test.ts server/test/inbound-requests.test.ts server/test/cabinet-validation.test.ts`

```text
✓ server/test/cabinet-validation.test.ts (2 tests)
✓ server/test/inventory.test.ts (4 tests)
✓ server/test/inbound-requests.test.ts (6 tests)
Test Files 3 passed (3); Tests 12 passed (12); 退出码 0
```

### Slice 5–6 — three-cabinet UI/forms

RED：`npm test -- --run client/src/App.test.tsx client/src/inventory-forms.test.tsx client/src/inbound-requests-ui.test.tsx`

```text
❯ client/src/inventory-forms.test.tsx (4 tests | 4 failed)
❯ client/src/inbound-requests-ui.test.tsx (5 tests | 1 failed)
❯ client/src/App.test.tsx (8 tests | 1 failed)
Test Files 3 failed (3); Tests 6 failed | 11 passed (17); 退出码 1
```

GREEN：同命令。

```text
✓ client/src/inventory-forms.test.tsx (4 tests)
✓ client/src/inbound-requests-ui.test.tsx (5 tests)
✓ client/src/App.test.tsx (8 tests)
Test Files 3 passed (3); Tests 17 passed (17); 退出码 0
```

Bundle phrase RED（初次审计）：`C · 酸柜` 缺失为连续 token；`单层`、`仅酸性物质` 存在。将完整 label 集中进 cabinet metadata 后 GREEN：

```text
client/dist/assets\index-C8dVfrO-.js:C · 酸柜
client/dist/assets\index-C8dVfrO-.js:单层
client/dist/assets\index-C8dVfrO-.js:仅酸性物质
```

### Slice 7 / final acceptance

Acceptance 扩展在前六个 RED→GREEN 切片之后加入，首次执行即 GREEN（底层行为已由前述切片驱动完成）：

```text
PASS acid cabinet: C1 direct inbound/query, C2 rejection, and bidirectional movement
PASS proxy inbound: C1 approval, C2 rejection, pending scopes, authorization/version conflicts, reject/withdraw, realtime
ACCEPTANCE OK (33 audit entries verified)
```

正式 V1.4 数据库只读源的一致副本验证：

```text
PASS V1.4 production database copy: 10 legacy tables unchanged; FK/index checks passed; C1 chemical/request writes passed; C2 constraints passed; second open idempotent
```

### Final verification

```text
npm test: 退出码 0；Test Files 27 passed (27)；Tests 84 passed (84)
npm run lint: 退出码 0
npm run build: 退出码 0；72 modules transformed；index-C8dVfrO-.js / index-W21ZEktu.css
npm run acceptance: 退出码 0；ACCEPTANCE OK (33 audit entries verified)
verify-acid-cabinet-upgrade: 退出码 0；10 legacy tables unchanged；FK/index/C1/C2/idempotence passed
git diff --check: 退出码 0；无空白错误（仅 LF→CRLF 提示）
package.json / package-lock.json diff: 无输出
未启动或修改端口 3000；未 commit
```

## V1.6 — 邀请码注册（2026-08-30）

按纵向切片逐项先 RED 后 GREEN：

1. 加密/持久化 RED：`registration-invites-storage.test.ts` 因 `registration-invites.js` 不存在而失败；GREEN：2/2（192-bit 格式、SHA-256-only、hint、7 天、V1.5 additive/idempotent/FK/旧表 JSON-SHA）。
2. 生成/列表/撤销 RED：4/4 因 API 404 失败；GREEN：4/4（完整角色矩阵、normal own-only、super all、strict body、审计无明文、权限/状态/version）。
3. 注册消费 RED：7 项中 6 项失败（带邀请码仍 400、并发双方均 400）；GREEN：7/7（missing/invalid/expired/revoked/used、注入、重复用户名、强制中途失败回滚、并发单消费）。
4. 前端 RED：管理模块不存在，注册字段/导航/安全回退失败；GREEN：12/12（必填邀请码、角色 DOM、一次显示/复制、中文状态、列表/撤销 payload、realtime event）。
5. 消费 realtime RED：等待 `registration-invite:changed` 超时；GREEN：注册 COMMIT 后广播安全 used view，不含 code/hash。

最终验证：

```text
npm test: Test Files 30 passed (30); Tests 98 passed (98)
npm run lint: 退出码 0
npm run build: 退出码 0；73 modules transformed；index-CweS2WaA.js / index-DQXGKifk.css
npm run acceptance: 退出码 0；ACCEPTANCE OK (39 audit entries verified)
V1.5 additive fixture: 所有旧表 row-count/JSON-SHA 不变；新表 0 行；二次打开幂等；FK check 空
bundle: 含“邀请码管理 / 邀请码 / 一次性 / 7 天”；无 LSF-<32 chars> 候选码
git diff --check: 退出码 0（仅 LF→CRLF 提示）
package.json / package-lock.json: diff 为空
未启动或修改端口 3000；未访问远程网络；未 commit
```

## 2026-08-30 — V1.7 Phase A 账号不可逆匿名删除

工作目录：`D:\hermes\worktrees\lab-chemical-manager-v1-7-account-modals`

基线/当前 HEAD：`9e343511b9ac2c2940b45f285b541d26aca5cb55`

范围严格限定为 Phase A：`users.deleted_at` additive migration、deleted 排除、超级管理员删除 API、后端测试/acceptance/升级验证；未修改 `client/src` 交互代码。

### Slice 1 — users.deleted_at additive/idempotent

RED：`npm test -- --run server/test/database-account-deletion.test.ts`

```text
server/test/database-account-deletion.test.ts (2 tests | 2 failed)
no such column: deleted_at
expected undefined to match object { name: 'deleted_at', ... }
Test Files 1 failed (1); Tests 2 failed (2)
```

GREEN：同命令。

```text
server/test/database-account-deletion.test.ts (2 tests)
Test Files 1 passed (1); Tests 2 passed (2)
```

覆盖：V1.6 旧 `users` 行原列逐值不变、只追加一个 nullable `deleted_at TEXT`、旧行默认 NULL、新库带列、二次打开幂等。

### Slice 2 — deleted availability exclusions

RED：`npm test -- --run server/test/deleted-user-exclusion.test.ts`

```text
expected 200 to be 401
Test Files 1 failed (1); Tests 1 failed (1)
```

GREEN：`npm test -- --run server/test/deleted-user-exclusion.test.ts server/test/auth.test.ts server/test/inbound-requests.test.ts`

```text
Test Files 3 passed (3); Tests 9 passed (9)
```

覆盖 active=1 但 deleted_at 非 NULL 的防绕过场景：session/me、login、users、members、PATCH、代入库目标、通知收件人全部排除 deleted；历史 JOIN 不排除，以保留匿名历史。

### Slice 3 — DELETE /api/users/:id transaction and guards

RED：`npm test -- --run server/test/account-deletion.test.ts`

```text
server/test/account-deletion.test.ts (4 tests | 4 failed)
expected 404 to be 403
expected 404 to be 200
expected [404, 404] to deeply equal [200, 404]
```

GREEN（加入 stale/concurrent last-super HTTP 覆盖后）：同命令。

```text
server/test/account-deletion.test.ts (5 tests)
Test Files 1 passed (1); Tests 5 passed (5)
```

覆盖：仅 super_admin、self 400、not-found/already-deleted 404、并发陈旧认证下 last-active-super 409、demo/非 demo 成功删除、`BEGIN IMMEDIATE` 串行 double delete、随机唯一墓碑 username、随机 scrypt 密码、active/demo/version/timestamp、session/notification/preference 原子清理、安全 `{id,mode}` realtime、目标 room disconnect、旧 cookie/login/PATCH 失效、管理员创建和邀请码注册复用原 username、删除审计无旧 username/displayName/password/hash。

### Slice 4 — FK/history retention and migration regression

账号删除测试建立 chemical/movement/purchase/inbound/invite/audit 历史后删除引用账号；所有业务行保留，`PRAGMA foreign_key_check` 为空，API 显示 `已删除用户 #<id>` 和随机墓碑 username。

旧 V1.4 migration fixture 首次回归运行按预期 RED：只有 `users` hash 因允许追加的 NULL 列变化；fixture 改为继续 hash 所有旧 users 列，未放宽其他表。

```text
RED: database-acid-cabinet users sha256 mismatch only
GREEN: database account/acid/weekly/invite migration suites — Test Files 4 passed; Tests 7 passed
```

### Acceptance extension

`npm run acceptance` 使用 `listen(0)` 的候选 HTTP，新增账号删除矩阵：guards、清理、随机墓碑、socket event/disconnect、原 username 邀请码重注册、历史/FK、demo/非 demo、并发 double delete。

```text
PASS account deletion: guards, cleanup, random tombstone, safe realtime/disconnect, username reuse, history/FK retention, demo/non-demo, concurrent idempotence
ACCEPTANCE OK (49 audit entries verified)
```

### V1.6 正式数据库只读源副本升级

命令：

```text
node server/dist/server/scripts/verify-account-deletion-upgrade.js D:\hermes\worktrees\lab-chemical-manager-v1\data\lab-chemical-manager.sqlite
```

验证脚本只 `copyFileSync` 到系统临时目录并仅升级副本。首次运行因 Node SQLite PRAGMA 行是 null-prototype、expected 是普通对象而在 harness deepEqual 失败；规范化该 metadata 行后 GREEN：

```text
PASS V1.6 production database copy: 11 tables and 5 users unchanged; nullable deleted_at added once; FK clean; second open idempotent
```

### Final verification

```text
npm test: 退出码 0；Test Files 33 passed (33)；Tests 106 passed (106)，原 98 tests 全保留
npm run lint: 退出码 0
npm run build: 退出码 0；73 modules transformed；index-CweS2WaA.js / index-DQXGKifk.css
npm run acceptance: 退出码 0；ACCEPTANCE OK (49 audit entries verified)
V1.6 production-copy verifier: 退出码 0；11 tables / 5 users unchanged；deleted_at once；FK clean；second open idempotent
git diff --check: 退出码 0（仅工作树 LF→CRLF 提示）
git diff --exit-code -- package.json package-lock.json: 退出码 0；无输出
git diff --exit-code -- client/src: 退出码 0；无输出
HEAD: 9e343511b9ac2c2940b45f285b541d26aca5cb55；未 commit
```

未启动、停止或修改活动端口 3000；所有新增 HTTP 测试/acceptance 使用系统分配临时端口；未操作远程服务。

## 2026-08-30 — V1.7 Phase B 统一应用内操作框

范围严格限定为 Phase B：保留上述 Phase A 服务端匿名删除语义与测试，替换生产 client 的全部原生交互框，补齐账号删除 UI。未修改依赖、lock 或远程服务，未 commit，未访问/停止/修改活动端口 3000。

基线先验：Phase A `npm test` 为 33 files / 106 tests 全绿；初始生产源码审计发现 10 个命中行、14 个原生 `prompt`/`confirm` 调用表达式。

### Slice 1 — ActionDialog / Modal 基础

RED：`npm test -- --run client/src/action-dialog.test.tsx`

```text
Cannot find module './action-dialog.js'
Test Files 1 failed (1)
```

GREEN：共享 `ActionDialog` 使用现有 `Modal`，提供唯一 ARIA title/description、真实 form submit、busy/error/danger/disabled、Enter 提交、Shift+Enter 换行、IME composing 防误提交。`Modal` 增加初始焦点、Tab/Shift+Tab containment、Escape、focus restore 和 busy-safe close。

```text
client/src/action-dialog.test.tsx (3 tests)
Test Files 1 passed (1); Tests 3 passed (3)
```

### Slice 2 — 药品废弃与代入库

RED：`npm test -- --run client/src/inventory-action-dialogs.test.tsx`

```text
Cannot find module './inventory-action-dialogs.js'
Test Files 1 failed (1)
```

GREEN：`ChemicalDiscardDialog` 显示药品/位置、可选 500 字原因、危险确认；`InboundRequestActionDialog` 在 InventoryView 与 NotificationsView 共用，显示申请/发起人/药品/位置并覆盖同意、拒绝、撤销。API route、comment normalization、version payload 保持不变。

```text
npm test -- --run client/src/inventory-action-dialogs.test.tsx client/src/inbound-requests-ui.test.tsx client/src/inventory-forms.test.tsx
Test Files 3 passed (3); Tests 13 passed (13)
```

初次 GREEN 运行只暴露测试 harness 问题：React SSR 输出 `maxLength` 大小写，以及同一个 mock Response body 不能重复消费；修正 harness 后产品断言全绿。

### Slice 3 — 采购六种操作

RED：`npm test -- --run client/src/purchase-action-dialog.test.tsx`

```text
Cannot find module './purchase-action-dialog.js'
Test Files 1 failed (1)
```

GREEN：我的申请和审批/采购任务页共用 `PurchaseActionDialog`；修改用途必填、撤销确认、通过意见可选、推迟/驳回说明必填且 whitespace 前端阻止、已采购显示药品与危险品属性。六条 API route、decision、comment、version 均由测试锁定。

```text
npm test -- --run client/src/purchase-action-dialog.test.tsx client/src/purchase-tasks-ui.test.tsx client/src/purchase-view.test.tsx
Test Files 3 passed (3); Tests 15 passed (15)
```

### Slice 4 — 账号编辑/启停/删除

RED：`npm test -- --run client/src/account-action-dialog.test.tsx`

```text
Cannot find module './account-action-dialog.js'
Test Files 1 failed (1)
```

GREEN：编辑框包含姓名、四个既有中文角色 label、可选新密码与确认；空密码不发送，非空密码至少 10 字且两次一致。启用/停用均确认；删除框说明不可逆匿名化与历史保留，username 大小写/空格完全一致才启用危险提交。DELETE 无 body，成功文案为“账号已删除”，当前登录账号行无删除 DOM。

```text
npm test -- --run client/src/account-action-dialog.test.tsx client/src/role-labels.test.tsx client/src/App.test.tsx
Test Files 3 passed (3); Tests 15 passed (15)
```

### Slice 5 — 邀请码撤销

RED：既有 invite suite 新增渲染断言后，`InviteRevokeDialog` 为 undefined，4 项中 1 项失败。

GREEN：active invite 的撤销按钮只打开危险 `ActionDialog`，继续复用既有 versioned revoke helper。

```text
npm test -- --run client/src/invite-management.test.tsx
Test Files 1 passed (1); Tests 4 passed (4)
```

### Native-dialog guard 与生产 bundle

新增 `native-dialog-guard.test.tsx` 递归扫描所有非测试生产 client TS/TSX。最终双重审计：

```text
production source native dialog calls: 0
production bundle index-CqEUvjk4.js native dialog calls: 0
bundle required modal phrases: 11/11
```

Bundle 命中文案包括：废弃原因、同意/拒绝说明、审批意见、推迟/驳回说明、新密码、确认新密码、确认删除、账号已删除、撤销邀请码。

### 隔离候选 UI 验收

构建后使用系统选择的 `60411` 端口和全新临时 SQLite；未连接端口 3000。通过浏览器实际检查：

- 废弃、代入库同意/拒绝/撤销（库存与消息复用）、采购六操作、账号编辑/启停/删除、邀请码撤销均为 `role=dialog`，每一步 `getJsDialog()` 均为空。
- 四个账号角色 label 精确；两次新密码不一致显示 inline alert；用途/推迟 whitespace 通过 Enter 提交时被前端阻止。
- 删除确认初始/错误大小写 disabled，精确 `member-a` enabled；当前 `@teacher` 行删除按钮 count=0；未在浏览器点击最终删除。
- 初验发现字段型 dialog 初始焦点落在关闭按钮；共享 Modal fallback selector 修复后初始焦点为首个 textarea/input。
- 无字段 dialog 的 Shift+Tab 从关闭按钮 wrap 到确认按钮，Tab wrap 回关闭按钮；Escape 后 dialog count=0；console warn/error=[]。

实际删除/账号安全语义由候选 HTTP acceptance 覆盖，浏览器验收不执行破坏性最终确认。

### Final verification

```text
npm test: 退出码 0；Test Files 38 passed (38)；Tests 124 passed (124)，原 Phase A 106 tests 全保留
npm run lint: 退出码 0
npm run build: 退出码 0；77 modules transformed；index-CqEUvjk4.js / index-DQ3Tsmpa.css
npm run acceptance: 退出码 0；ACCEPTANCE OK (49 audit entries verified)
V1.6 production-copy verifier: 退出码 0；11 tables / 5 users unchanged；deleted_at once；FK clean；second open idempotent
```

清理 blocker：候选进程已停止且 60411 无 listener；浏览器 tab 已关闭。命令安全策略拒绝删除 workspace 外已核验的临时目录，故以下 disposable fixture 仍留在系统 temp（仅 `candidate.sqlite`，114688 bytes，可安全手工删除）：

```text
C:\Users\22808\AppData\Local\Temp\lab-chemical-manager-phase-b-e88b144268ab4b2789ee70b2496567cd
```

## 2026-08-31 — V1.8 Phase A 密码修改与恢复后端

范围严格限定为 Phase A：新增 additive/idempotent `password_reset_requests`、公开密码查询/原密码修改/申请/申诉/批准后重置 API、normal/super 管理员专用队列和审批、消息/公开审计/实时失效信号。未实现登录七阶段 wizard、消息审批 Modal、危险品角色/矩阵或任何性能项；未修改依赖/lock，未 commit，未访问或操作活动端口 3000/远程服务。

安全边界：姓名只定位 active 且未删除的候选账号；申请生成 32-byte 随机 token，SQLite 只存 SHA-256，浏览器 Cookie 为 `HttpOnly; SameSite=Lax; Path=/; Expires=7天` 并按 `cookieSecure` 加 `Secure`。无原密码重置同时绑定 token hash、user、approved、version 和未过期条件。公开申请/申诉审计明确记录 `identityVerified=false`；`password-reset-request:changed` 只广播 `id/status/version/updatedAt`，不广播身份、申诉、审批内容或 token/hash。

### Slice 1 — additive/idempotent schema 与 unresolved 唯一性

RED：`npm test -- --run server/test/database-password-recovery.test.ts`

```text
server/test/database-password-recovery.test.ts (2 tests | 2 failed)
expected [] to deeply equal password_reset_requests columns
expected [] to have a length of 6
```

GREEN：同命令。

```text
Test Files 1 passed (1); Tests 2 passed (2)
```

覆盖 13 列、user/reviewer FK、token hash UNIQUE/CHECK、status CHECK、三个查询索引和 unresolved partial unique index；resolved 后允许新申请。合成 V1.7 文件库原 `users`/marker schema 与行逐值不变，首次新增为空，二次打开 schema/rows 完全一致，FK clean。

### Slice 2 — lookup 与 change-with-current

RED：`npm test -- --run server/test/password-recovery-public.test.ts`

```text
server/test/password-recovery-public.test.ts (5 tests | 5 failed)
all public routes returned pre-existing authenticated 401
```

GREEN（含 schema 回归）：

```text
Test Files 2 passed (2); Tests 7 passed (7)
```

覆盖 `verify_current/pending/approved/rejected/appealed`、consumed/expired 回落、无/错 Cookie 隔离其他浏览器申请、active/deleted/0/同名；新密码 >=10/确认一致；不存在姓名与错误原密码相同 generic 401。成功改密原子更新 hash/version、删除全部 sessions、过期所有 unresolved authority、写无密码审计并断开 user room。强制 audit trigger 失败时密码/session/audit 全回滚。

### Slice 3 — request、Cookie、通知与重复/并发

RED：`npm test -- --run server/test/password-recovery-request.test.ts`

```text
server/test/password-recovery-request.test.ts (5 tests | 5 failed)
request route returned pre-existing authenticated 401
```

GREEN：request/public/category focused suites。

```text
Test Files 3 passed (3); Tests 12 passed (12)
```

覆盖 43-char base64url/解码 32 bytes、7天 Expires、HttpOnly/Lax/Path、配置化 Secure（发放与清除）、DB 仅 SHA-256；normal_admin+super_admin `password_reset` 消息、公开审计、私有 notification realtime 和最小 request realtime。0/同名、重复 409、两并发仅 `[201,409]`，每用户仅一 unresolved；创建前旧过期请求变 expired/version+1。通知 trigger 失败时 request/audit/messages 全回滚且无 Set-Cookie。

### Slice 4 — 管理员专用队列与 decision

RED：`npm test -- --run server/test/password-reset-admin.test.ts`

```text
server/test/password-reset-admin.test.ts (5 tests | 5 failed)
missing admin routes returned 404
```

GREEN（与前三个后端 slice 合跑）：

```text
Test Files 3 passed (3); Tests 15 passed (15)
```

覆盖 unauthenticated 401、member/hazard 403、normal/super 200；队列只含未过期 pending/appealed，通知偏好关闭仍不隐藏，返回必要 user/appeal/reviewer 信息且无 token/hash/password。拒绝说明必填，审批写 reviewer/comment/reviewedAt/version、subject notification/audit/realtime；wrong version/state 同一 generic 409，两管理员并发仅一个成功。过期先持久化 expired；通知 trigger 失败时 decision/reviewer/version/audit 全回滚。

### Slice 5 — appeal 与 reset-approved 完整事务

RED：`npm test -- --run server/test/password-recovery-appeal-reset.test.ts`

```text
server/test/password-recovery-appeal-reset.test.ts (7 tests | 7 failed)
appeal/reset routes returned pre-existing authenticated 401
```

GREEN（全部 recovery 后端 slice）：

```text
Test Files 4 passed (4); Tests 22 passed (22)
```

覆盖申诉理由必填/<=1000、仅 matching Cookie + rejected、appealed/version+1、admin notifications/audit/realtime 且采购 task count 不变；无/错 Cookie 相同 generic 401，错状态/过期/重复为 generic 409，并发申诉单赢家。批准后重置验证 matching hash/user/status/version/expiry，原子更新密码、清 sessions、request consumed/consumedAt/version、审计、Cookie 清除和 socket disconnect；无/错 Cookie、非 approved、过期、重用和双并发覆盖。强制 appeal notification/reset audit 失败均验证整体回滚。

### Realtime/identity hardening RED→GREEN

在首次 GREEN 后把 realtime 断言收紧为精确四字段，并要求 public audit 明示未核验身份；运行 request+appeal/reset suites 得到 2 failures（原 payload 仍含 user/reason/review），实现最小事件和 `identityVerified=false` 后：

```text
Test Files 3 passed (3); Tests 17 passed (17)
```

### Acceptance extension

`server/scripts/acceptance.ts` 继续使用 `listen(0)`，新增独立账号覆盖：原密码自由改密；32-byte/hash-only request；同/错浏览器 Cookie；管理员 role/专用队列/decision；拒绝→申诉→批准；批准后仅原 Cookie 重置；旧 sessions/旧密码失效；消息/audit/持久化零明文泄漏；密码请求不进入采购任务。

```text
PASS password recovery: current-password change, HttpOnly hash-only request, cookie isolation, admin queue/decision, appeal, approved reset, session revocation, zero plaintext leakage
ACCEPTANCE OK (61 audit entries verified)
```

### V1.7 正式数据库 staged-copy 升级

源 `D:\hermes\worktrees\lab-chemical-manager-v1\data\lab-chemical-manager.sqlite` 始终只读；显式候选副本先用 V1.7 baseline build 升级，再由新增 verifier 内部复制到系统 temp 并执行 V1.8 upgrade。候选文件验证后已 `git clean -f --` 精确清除，无残留。

```text
PASS V1.7 database copy: 11 legacy tables / 12 rows unchanged; password_reset_requests added empty with 5 indexes; FK clean; second open idempotent
```

### Final verification

```text
focused: 退出码 0；Test Files 7 passed (7)；Tests 28 passed (28)
npm test: 退出码 0；Test Files 43 passed (43)；Tests 148 passed (148)，原 V1.7 124 tests 全保留
npm run lint: 退出码 0
npm run build: 退出码 0；77 modules transformed；index-AAC_056U.js / index-DQ3Tsmpa.css
npm run acceptance: 退出码 0；ACCEPTANCE OK (61 audit entries verified)
V1.7 staged production-copy verifier: 退出码 0；11 tables / 12 rows unchanged；empty table + 5 indexes；FK clean；second open idempotent
git diff --check: 退出码 0（仅工作树 LF→CRLF 提示）
git diff --exit-code -- package.json package-lock.json: 退出码 0；无输出
wizard/hazard/performance scoped-file diff: 退出码 0；无输出
HEAD: 2534d3fcc4037039e64fd8e09270beeab5f0a7a5；未 commit
```

首次 full regression 按预期只暴露 V1.4 migration fixture 把新空表计入“旧业务表”snapshot（42 files/147 tests 已通过、1 fixture failed）；fixture 继续逐表 hash 所有 V1.4 表，仅排除允许的 additive recovery table。修正后五个 migration suites 为 5 files/9 tests 全绿，最终 full 全绿。无 blocker，无候选数据库/进程残留。

## 2026-08-31 — V1.8 Phase B 七阶段 UI、消息审批与危险品两阶段模型

范围严格限定为 Phase B：在 Phase A 后端与安全边界之上实现登录页七阶段修改/恢复/申诉 UI、消息中心专用密码申请队列和应用内通过/拒绝框；修正采购四分类审批矩阵，增加 `pending_hazardous` / `deferred_hazardous`、危险采购人审批导航、角色可见名、阶段通知和编辑后阶段保持。未实现或改动 Phase C 的 realtime 合并、请求拆分/debounce、SQLite WAL/索引、静态缓存、有界查询或性能脚本；未修改依赖/lock，未 commit，未访问或操作活动端口 3000/远程服务。

Phase A 基线先验：

```text
npm test -- --reporter=dot
Test Files 43 passed (43); Tests 148 passed (148)
```

### Slice 1 — 四分类与两阶段服务端矩阵

RED：先新增角色 × 四类申请、初始状态/通知、队列、加急危险两阶段、危险推迟/编辑和旧 normal 危险 deferred 兼容测试；旧实现 5 项全部失败。

```text
npm test -- --run server/test/purchase-approval-matrix-v18.test.ts --reporter=verbose
Test Files 1 failed (1); Tests 5 failed (5)
wrong pending_normal for normal hazardous
normal_admin could approve normal hazardous
normal_admin queue included hazardous work
urgent hazardous became approved directly
hazardous_buyer could not process the hazardous stage
```

在生产实现前继续把修改通知 audience 加入同一 RED suite。首轮 GREEN 后套件共 6 项：

```text
Test Files 1 passed (1); Tests 6 passed (6)
```

覆盖：

- normal 非危险 → `pending_normal`，normal/super；normal 危险 → `pending_hazardous`，hazard/super；所有 urgent → `pending_super`，第一阶段仅 super。
- 16 个“角色 × 申请类别”首个决定组合逐项验证 200/403、状态和 version；尤其 hazard 对尚在 `pending_super` 的加急危险品为 403。
- 加急危险品老师通过只进入 `pending_hazardous`，写 `purchase_hazardous_review_requested`，通知 hazard+super，且无 `待采购任务`；危险复核通过后才 approved/通知申请人/创建危险采购任务。
- 危险复核推迟 → `deferred_hazardous`；编辑 → `pending_hazardous`，不重走老师阶段；普通/加急非危险编辑分别回原 normal/super 阶段；兼容旧 normal 危险 `deferred`。
- normal/hazard/super 审批队列与 summary 精确；创建和修改的四类 notification audience/category 精确；采购完成权限未变。

最终 diff 审核又识别出一个 mutation 绕过候选：普通危险品在 `pending_hazardous` 时若把 requestType 改成 urgent，不能沿用尚未经过老师的危险复核阶段。先补 focused RED：

```text
npm test -- --run server/test/purchase-approval-matrix-v18.test.ts -t "cannot gain urgent" --reporter=verbose
expected pending_super; received pending_hazardous
Tests 1 failed | 6 skipped
```

GREEN：只有“原请求已经是 urgent 且已经到达危险复核”的编辑才保持第二阶段；normal → urgent 必须回 `pending_super`，hazard 为 403，老师通过后才再进 `pending_hazardous`。

```text
Test Files 1 passed (1); Tests 7 passed (7)
```

### Slice 2 — 登录页七阶段 UI

RED：

```text
npm test -- --run client/src/password-recovery-ui.test.tsx --reporter=verbose
Cannot find module './password-recovery-ui.js'
Test Files 1 failed (1)
```

GREEN：`PasswordRecoveryFlow` 复用 Phase A 五条公开 API，并将 lookup 的 `verify_current / pending / appealed / approved / rejected` 映射到浏览器当前 Cookie 对应界面。七阶段渲染测试逐屏锁定允许字段、按钮、required/minLength/maxLength 和等待/拒绝文案；API 测试锁定 exact path/body，并证明 approved reset 与 appeal body 不携带姓名。

```text
client/src/password-recovery-ui.test.tsx (4 tests)
```

登录默认页只有“修改密码”入口，不预渲染申请/申诉控件；自由修改成功与批准后重置成功均回登录并显示成功提示。申请页明确人工核验和同浏览器限制；pending/appealed 共用只读等待页；rejected 才能进入 1000 字申诉页。

### Slice 3 — 消息中心专用密码审批队列/Modal

RED：

```text
npm test -- --run client/src/password-reset-admin-ui.test.tsx --reporter=verbose
Cannot find module './password-reset-admin-ui.js'
Test Files 1 failed (1)
```

GREEN：

```text
Test Files 1 passed (1); Tests 5 passed (5)
```

覆盖 normal/super 可见、member/hazard 不加载；pending 显示“密码修改申请”、appealed 显示“密码修改申诉”和理由；队列为空仍独立显示，因而不受个人通知类别/阅读筛选或 preference 影响。通过说明可选、拒绝说明必填并阻止 whitespace；应用内 `ActionDialog` 展示人工身份核验警告、user/version，提交 exact decision/comment/version，DOM/payload 无 token/hash。`password-reset-request:changed` 已加入 client revision invalidation；主导航无密码任务项。

### Slice 4 — 危险审批前端状态/导航/角色名

RED：

```text
npm test -- --run client/src/purchase-approval-ui-v18.test.tsx --reporter=verbose
Test Files 1 failed (1); Tests 5 failed (5)
```

失败点分别为缺少 client 角色/阶段矩阵、缺少“危险品复核”阶段标签、缺少两个新状态、hazard 无待审批导航/旧角色名、缺少 password-reset realtime invalidation。GREEN 后 5/5；连同既有 UI 回归：

```text
Test Files 8 passed (8); Tests 33 passed (33)
```

审批页按钮按 persisted stage + role 再过滤（服务端仍是安全边界）；`pending_hazardous` / `deferred_hazardous` 行明确标成“危险品复核”，不会显示为老师加急审批。`hazardous_buyer` 内部枚举保持不变，可见名改为“审批与危险采购人”，左侧同时显示待审批/待采购，但仍无邀请码或密码重置栏目。

### Acceptance / production bundle

`server/scripts/acceptance.ts` 保持 in-memory SQLite + `listen(0)`，新增/修正：四类初始状态和通知 audience、normal/hazard/super 队列、hazard 对 urgent first-stage 403、老师通过后无采购任务、hazard+super 危险复核通知、`deferred_hazardous` 编辑回第二阶段、危险复核最终通过才创建采购任务、两阶段 audit 保留。

```text
PASS purchase state machine: four-class matrix, super-only urgent first stage, hazardous second-stage defer/edit/approve, reject/withdraw
ACCEPTANCE OK (64 audit entries verified)
```

production build 为 79 modules；bundle 同时包含七个阶段标题、“提交申诉并申请”、“密码修改审批/申诉”、“危险品复核”和“审批与危险采购人”。生产 client 原生 prompt/confirm/alert 调用为 0。

### Final verification

```text
npm test: 退出码 0；Test Files 47 passed (47)；Tests 169 passed (169)，Phase A 基线 148 tests 全保留
npm run lint: 退出码 0
npm run build: 退出码 0；79 modules transformed；index-BpoPTBGQ.js / index-BR7tbcGd.css
npm run acceptance: 退出码 0；ACCEPTANCE OK (64 audit entries verified)
V1.7 staged production-copy verifier: 退出码 0；11 legacy tables / 12 rows unchanged；empty recovery table + 5 indexes；FK clean；second open idempotent
production bundle: 12/12 required Phase B phrases；production native dialog calls 0
git diff --check: 退出码 0（仅工作树 LF→CRLF 提示）
git diff --exit-code -- package.json package-lock.json: 退出码 0；无依赖/lock 改动
Phase C implementation marker scan: none
HEAD: 2534d3fcc4037039e64fd8e09270beeab5f0a7a5；未 commit
```

所有 HTTP test/acceptance 继续使用系统分配端口，未访问、停止或修改活动端口 3000；未启动候选常驻进程，无临时数据库/进程需要清理。无 blocker。

## 2026-08-31 — V1.8 Phase C 2C/4T/6GB 性能优化

范围严格限定为 SPEC C1–C6；Phase A+B 基线先完整复跑：47 files / 169 tests 全通过。没有新增依赖、没有 lockfile/commit/远程/活动 3000 操作，所有 HTTP 与 benchmark 均监听系统分配端口。

### C1 — realtime burst coalescing / authoritative unread

RED 先锁定 50–100 ms 窗口、20 次调度只刷新一次和 cleanup 取消 timer；旧模块缺少 scheduler：

```text
client/src/realtime-events.test.tsx
2 failed | 1 passed
TypeError: createRevisionScheduler is not a function
```

GREEN 使用 75 ms single-pending-timer scheduler。所有 entity/audit/notification/read/preference Socket 事件只调用 scheduler；cleanup 同时 cancel timer 和关闭 Socket。未读数不再 `+1`，而在合并后的 revision 上重新请求服务端计数。

```text
Test Files 2 passed (2); Tests 11 passed (11)
20-event transaction burst -> one refresh; cleanup -> zero refresh
```

### C2 — inventory request plan / debounce / stale response

RED：

```text
Cannot find module './inventory-requests.js'
Test Files 1 failed (1)
```

GREEN：搜索输入固定 250 ms debounce；search plan 只有编码后的 `/chemicals?search=`，revision plan 才含 members/incoming/mine。chemical 与 supporting 两组各自取消旧 `AbortController`，并以 current gate 阻止忽略 abort 的旧响应写回；effect cleanup 同样取消请求/定时器。

```text
client/src/inventory-requests.test.tsx: 3 passed
request-planning/inventory focused regression: 3 files / 12 tests passed
```

### C3 — file SQLite configuration / additive index

真实临时 legacy 文件库 RED：journal mode 为 `delete`，且 memory/file 均缺少 `idx_audit_logs_created`（2 failed）。GREEN 后文件连接依次安装 5000 ms busy timeout、WAL、NORMAL；memory 仍为 `journal_mode=memory`。原 users/audit 行逐值不变，foreign_keys=1、`foreign_key_check=[]`，新索引存在。

```text
performance-database + password-recovery migration + acid-cabinet migration
Test Files 3 passed (3); Tests 6 passed (6)
file: journal_mode=wal, synchronous=1, busy_timeout=5000
legacy rows unchanged; FK clean; memory compatible
```

Phase B 已完成并保留 V1.7 staged production-copy 结果（11 legacy tables / 12 rows unchanged；empty recovery table + 5 indexes；FK clean；second open idempotent）。Phase C 没有重新打开活动源库；无参数调用 verifier 被其 usage assertion 在任何 DB I/O 前拒绝，不计作验证，也未触碰活动库。C3 的独立临时 legacy 文件测试覆盖本阶段 PRAGMA/index/行保持变化。

### C4 — static/API/Socket cache headers

临时 client build 的 HTTP RED 首先证明旧系统忽略 test dist 且无所需 header。首次实现又由测试识别出 Engine.IO 自带 `no-store` 与大小写不同的附加 header 合并为 `no-store, no-store`；统一覆盖小写 header 后 GREEN：

```text
/assets/app-a1b2c3.js -> public,max-age=31536000,immutable
/, /index.html, /inventory/deep-link -> no-cache
/api/health, Socket.IO polling -> no-store
Test Files 1 passed (1); Tests 1 passed (1)
```

### C5 — bounded lists / complete task semantics

RED 高容量测试：audit 原本已正确 500/id DESC；purchases all 返回 520 而不是 500；notifications 列表的 unreadCount 误取展示窗口 500 而不是真实 510。

```text
Test Files 1 failed (1); Tests 2 failed | 1 passed (3)
```

GREEN 后 audit 与 purchases all/mine 都最多 500 且 ID 倒序；notifications 展示仍为 500，但 list 和专用 endpoint 共用独立 SQL COUNT。审批任务 520 条、加急目录 505 条均完整返回，明确不截断任务/目录业务语义。

```text
bounded lists + purchase tasks + routing
Test Files 3 passed (3); Tests 7 passed (7)
```

### C6 — dependency-free benchmark / thresholds

RED 从不存在的 benchmark module 开始。GREEN contract 锁定至少 1000 audits / 500 purchases、100 health runs、20 并发、nearest-rank p50/p95、严格 p95<200 ms 与 RSS<250 MB；等于阈值即失败，任一并发错误即失败。脚本不引入 package，在临时 WAL 文件库填充 1200/600 行，异常/成功均关闭 server/DB 并删除 temp 目录。

最终 production build 后当前机器实测（只作回归线，不声称等同目标服务器）：

```text
endpoint    runs  p50 ms  p95 ms  response bytes  rows
health       100    15.24    16.28              15     1
audit         30    15.17    16.07          121113   500
purchases     30    14.64    17.15          192015   500
20 concurrent health: 0 errors, 16.22 ms elapsed
RSS: 93.14 MB
thresholds: PASS (p95 < 200 ms; RSS < 250 MB)
```

### Phase C final verification

```text
npm test: exit 0; Test Files 52 passed (52); Tests 183 passed (183)
npm run lint: exit 0
npm run build: exit 0; 80 modules transformed; index-L4P3XQ5z.js / index-BR7tbcGd.css
npm run acceptance: exit 0; ACCEPTANCE OK (64 audit entries verified)
node server/dist/server/scripts/performance-benchmark.js: exit 0; thresholds passed
git diff --check: exit 0（仅工作树 LF→CRLF 提示）
git diff --exit-code -- package.json package-lock.json: exit 0；无 dependency/lock 改动
Phase C files trailing-whitespace scan: 0 matches
temp benchmark/test directories: 0；本 worktree Node processes: 0
HEAD: 2534d3fcc4037039e64fd8e09270beeab5f0a7a5；未 commit
```

无已知功能 blocker。V1.7 active source 未在 Phase C 重跑是明确的安全边界，不影响独立 legacy migration regression 和已保留的 Phase B staged-copy 证据。
