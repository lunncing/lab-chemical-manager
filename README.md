# 李少锋课题组 · 药品管理

局域网实验室药品管理 MVP。一个 Node.js 进程提供 Express REST API、经 Cookie 鉴权的 Socket.IO 实时事件，并托管 React/Vite 生产构建；业务数据持久化到 SQLite。

## 本地运行（Windows / Node.js 22）

```powershell
npm install
npm run build
npm start
```

默认访问 `http://localhost:3000`，数据库首次启动时自动创建在 `data/lab-chemical-manager.sqlite`。可复制 `.env.example` 为 `.env` 后修改端口、数据库位置、Cookie Secure 和会话天数。局域网若以 HTTPS 反向代理部署，应设置 `COOKIE_SECURE=true`。

开发命令：

```powershell
npm run dev
npm test
npm run lint
npm run acceptance
```

`npm run acceptance` 从空的内存 SQLite 数据库启动真实 HTTP/Socket.IO 服务，覆盖角色鉴权、库存全流程、采购状态机、目录和危险品路由、消息偏好、审计及双客户端实时事件。

## 首测演示账号

| 用户名 | 角色 |
|---|---|
| `teacher` | 超级管理员 |
| `admin` | 普通管理员 |
| `hazard` | 危险品采购人 |
| `member-a` | 普通成员 |
| `member-b` | 普通成员 |

首测统一密码为 `Demo1234!`，仅用于首次验证，不是生产安全方案。首次部署后应：

1. 使用 `teacher` 登录，在“账号管理”创建一个使用独立强密码的真实超级管理员。
2. 退出并使用新账号登录，确认可进入账号管理。
3. 停用 `teacher`、`admin`、`hazard`、`member-a`、`member-b` 演示账号，再创建所需真实账号。
4. 为 HTTPS 部署启用 `COOKIE_SECURE=true`，并限制主机仅在可信局域网可达。

密码用带随机盐的 Node.js `scrypt` 哈希。服务端仅保存会话令牌的 SHA-256 摘要；浏览器 Cookie 为 HttpOnly、SameSite=Lax，并可配置 Secure。

## 功能

- A 常温柜和 B 冷藏柜，各五层；入库、跨归属人调动、二次确认废弃、搜索和历史追溯。
- 所有业务变更与只读公开审计日志同 SQLite 事务提交。
- 普通/加急采购状态机，乐观版本冲突返回 409；普通周目录、加急目录和危险品采购队列按角色开放。
- 八类持久化个人消息、未读数、单条/全部已读和仅影响未来消息的分类开关。
- Socket.IO Cookie 鉴权；库存、采购、审计、通知偏好和消息状态实时同步。
- 超级管理员账号创建、角色/状态更新和演示账号停用；关键权限全部由服务端验证。

## 目录

```text
client/          React + Vite 操作台
server/src/      Express、Socket.IO、SQLite 和领域路由
server/test/     真实 HTTP 与实时集成测试
server/scripts/  从空数据库运行的验收脚本
shared/          客户端/服务端共享领域类型
docs/            架构、数据模型与 TDD 证据
```

生产进程会在 `client/dist` 存在时托管其静态文件。`data/`、`.env`、日志、构建目录和 `node_modules/` 已被 Git 忽略；制作交付 zip 时同样不要包含它们。
