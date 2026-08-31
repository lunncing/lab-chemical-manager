# 架构与数据模型

## 请求与事件边界

浏览器只访问同源 `/api` 和 `/socket.io`。登录后，服务端把随机会话令牌放入 HttpOnly Cookie，SQLite 仅存令牌摘要。REST 中间件和 Socket.IO 握手使用同一会话校验；角色判断在路由写入前执行。

密码恢复是登录页内的七阶段独立公开入口，但姓名只用于定位候选账号，不能授予重置权。申请成功后浏览器持有 32-byte 随机 `lab_password_recovery` HttpOnly Cookie，数据库只保存 SHA-256；无原密码重置必须同时满足同一 Cookie、对应用户、approved 状态、乐观版本和未过期。公开申请/申诉审计明确标记 `identityVerified=false`，管理员批准前仍须线下核验身份。normal/super 的消息中心另行加载专用待处理队列并使用应用内审批框；通知偏好不隐藏该队列，左侧采购任务导航不承载密码请求。

每个关键写操作遵循同一顺序：校验输入和权限 → `BEGIN IMMEDIATE` → 带版本条件写业务表 → 写审计 → 按用户偏好写个人消息 → `COMMIT` → 广播已提交实体、审计和个人消息。任何一步异常都会回滚。实时事件只用于加速 UI；刷新后仍以 SQLite 中的业务数据和未读消息为准。

## 表

| 表 | 用途与关键约束 |
|---|---|
| `users` | 唯一用户名、scrypt 密码哈希、四种角色、启停/演示标志、`version` |
| `sessions` | SHA-256 会话摘要、用户外键、到期时间 |
| `password_reset_requests` | hash-only 恢复凭据、六状态审批/申诉/消费生命周期、过期时间和乐观版本；partial unique index 保证每用户至多一个 unresolved 请求 |
| `chemicals` | 名称/规格、归属与入库操作人、A/B 柜、1–5 层、活动/废弃状态、`version` |
| `inventory_movements` | 入库、调动、废弃的操作者、原/新位置和原因历史 |
| `purchases` | 药品、用途、危险品标志、普通/加急、申请人、两阶段状态（含 `pending_hazardous` / `deferred_hazardous`）、审批意见、`version` 和时间戳 |
| `audit_logs` | 只增不改的操作者、动作、对象、可读摘要和 JSON 详情 |
| `notification_preferences` | 用户与十类消息的未来投递开关 |
| `notifications` | 用户专属的持久消息和已读时间 |

SQLite `CHECK` 约束再次限制柜号、柜层、角色、采购类型和库存状态。所有查询均使用参数绑定。客户端提交写入时携带实体版本；SQL 使用 `WHERE id=? AND version=?`，零行更新转成 HTTP 409。

## 角色矩阵

| 能力 | member | normal_admin | super_admin | hazardous_buyer |
|---|:---:|:---:|:---:|:---:|
| 库存、公开日志、全部申请 | ✓ | ✓ | ✓ | ✓ |
| 创建/修改/撤销自己的申请 | ✓ | ✓ | ✓ | ✓ |
| 审批普通非危险申请 |  | ✓ | ✓ |  |
| 加急申请第一阶段 |  |  | ✓ |  |
| 危险品复核 |  |  | ✓ | ✓ |
| 普通/加急采购目录 |  | ✓ | ✓ |  |
| 危险品采购队列 |  |  | ✓ | ✓ |
| 消息中心密码修改审批 |  | ✓ | ✓ |  |
| 账号管理 |  |  | ✓ |  |

所有加急申请先进入 `pending_super`，第一阶段只有 super_admin 可以处理。加急危险品初审通过只转入 `pending_hazardous` 并通知危险复核角色，不创建待采购任务；危险复核通过后才进入 `approved`。普通危险品创建后直接进入危险复核。危险复核推迟使用 `deferred_hazardous`，申请人编辑后回到 `pending_hazardous`，不会重走老师阶段。normal_admin 的审批队列仅含普通非危险品；hazardous_buyer 的审批队列仅含危险复核阶段及兼容的旧 normal 危险 deferred 行；super_admin 可处理全部阶段。采购完成权限保持危险品 hazard/super、非危险品 normal/super。

## 实时事件

公开的 `chemical:changed`、`purchase:changed`、`audit:created` 发送到所有已鉴权 Socket；`password-reset-request:changed` 只携带 `id/status/version/updatedAt` 失效信号，不广播姓名、申诉或审批内容，并触发消息中心专用队列重新加载；`notification:created` 和已读事件发送到 `user:{id}` 房间。客户端收到事件后重新获取相应持久状态，避免以事件负载作为唯一事实来源。

## 低配运行策略

客户端用 75 ms scheduler 合并同一事务产生的实体、审计和通知事件；timer 在 Socket cleanup 时取消。合并后只推进一次 revision，未读数始终重新读取服务端 `COUNT`，不在浏览器累加。库存搜索固定防抖 250 ms，只请求 `/chemicals?search=`；members、incoming、mine 只随 revision 加载，两个请求组各自使用 `AbortController` 和 current-request gate 防止旧响应覆盖。

文件 SQLite 连接使用 WAL、`synchronous=NORMAL` 和 5000 ms busy timeout；`:memory:` 保持兼容，foreign keys 始终启用。审计按 ID 倒序最多 500 条，采购 all/mine 最多 500 条；审批任务和目录保持完整业务语义，notifications 保持 500 条展示但未读数使用独立 `COUNT`。生产 `/assets/*` 使用一年 immutable 缓存，index/SPA fallback 使用 `no-cache`，API 与 Socket 使用 `no-store`。

低配回归基准先执行 `npm run build:server`，再执行 `node server/dist/server/scripts/performance-benchmark.js`。脚本仅使用 Node 内置能力和应用代码，在系统临时目录创建文件数据库、监听系统分配端口、报告 health/audit/purchases 的 p50/p95/响应大小/行数、20 并发错误数和 RSS，最后关闭服务并删除数据库；阈值只代表当前机器回归线，不等同目标服务器实测。
