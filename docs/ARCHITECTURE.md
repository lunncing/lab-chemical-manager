# 架构与数据模型

## 请求与事件边界

浏览器只访问同源 `/api` 和 `/socket.io`。登录后，服务端把随机会话令牌放入 HttpOnly Cookie，SQLite 仅存令牌摘要。REST 中间件和 Socket.IO 握手使用同一会话校验；角色判断在路由写入前执行。

每个关键写操作遵循同一顺序：校验输入和权限 → `BEGIN IMMEDIATE` → 带版本条件写业务表 → 写审计 → 按用户偏好写个人消息 → `COMMIT` → 广播已提交实体、审计和个人消息。任何一步异常都会回滚。实时事件只用于加速 UI；刷新后仍以 SQLite 中的业务数据和未读消息为准。

## 表

| 表 | 用途与关键约束 |
|---|---|
| `users` | 唯一用户名、scrypt 密码哈希、四种角色、启停/演示标志、`version` |
| `sessions` | SHA-256 会话摘要、用户外键、到期时间 |
| `chemicals` | 名称/规格、归属与入库操作人、A/B 柜、1–5 层、活动/废弃状态、`version` |
| `inventory_movements` | 入库、调动、废弃的操作者、原/新位置和原因历史 |
| `purchases` | 药品、用途、危险品标志、普通/加急、申请人、状态、审批意见、`version` 和时间戳 |
| `audit_logs` | 只增不改的操作者、动作、对象、可读摘要和 JSON 详情 |
| `notification_preferences` | 用户与八类消息的未来投递开关 |
| `notifications` | 用户专属的持久消息和已读时间 |

SQLite `CHECK` 约束再次限制柜号、柜层、角色、采购类型和库存状态。所有查询均使用参数绑定。客户端提交写入时携带实体版本；SQL 使用 `WHERE id=? AND version=?`，零行更新转成 HTTP 409。

## 角色矩阵

| 能力 | member | normal_admin | super_admin | hazardous_buyer |
|---|:---:|:---:|:---:|:---:|
| 库存、公开日志、全部申请 | ✓ | ✓ | ✓ | ✓ |
| 创建/修改/撤销自己的申请 | ✓ | ✓ | ✓ | ✓ |
| 审批普通申请 |  | ✓ | ✓ |  |
| 审批加急申请 |  |  | ✓ |  |
| 普通/加急采购目录 |  | ✓ | ✓ |  |
| 危险品采购队列 |  |  | ✓ | ✓ |
| 账号管理 |  |  | ✓ |  |

## 实时事件

公开的 `chemical:changed`、`purchase:changed`、`audit:created` 发送到所有已鉴权 Socket；`notification:created` 和已读事件发送到 `user:{id}` 房间。客户端收到事件后重新获取相应持久状态，避免以事件负载作为唯一事实来源。
