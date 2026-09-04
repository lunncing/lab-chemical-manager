# 李少锋课题组药品管理系统

面向实验室局域网的药品库存、代入库、采购审批、采购执行、消息与审计系统。一个 Node.js 进程同时提供 Express API、Socket.IO 实时更新和 React 用户端，数据保存在本机 SQLite。

当前版本：**V1.9.0**

## 主要功能

- A 常温柜、B 冷藏柜各 5 层；C1 酸柜、C2 碱柜、G1 高效液相色谱旁手套箱和 G2 靠墙手套箱均为独立单层位置，并明确提示人工确认约束。
- 直接/代入库可选填并校验 CAS 号；库存可按 CAS 搜索，归属人或超级管理员可通过应用内弹窗更正活跃药品的名称、规格、CAS 号和入库时间。
- 普通入库固定当前账号；代入库需要目标人员同意，支持拒绝和发起人撤销。
- 普通成员、审批与普通采购人、审批与危险采购人、超级管理员四类权限。
- 普通/加急采购申请、待审批、待采购、已采购和角色化任务数量；所有加急申请先由老师审批，加急危险品再进入危险品复核。
- 危险品与非危险品采购目录及采购完成权限隔离。
- 普通非危险品按北京时间周一至周日归档，可查看本周和历史周；已采购记录仍留在原周。
- 个人消息、通知类别/已读筛选、通知偏好、全员可见改动日志。
- Socket.IO 实时同步；服务端权限检查、乐观版本冲突和事务化审计。
- 注册必须使用一次性、7 天有效的邀请码；邀请码仅由审批与普通采购人或超级管理员生成，注册账号固定为普通成员。
- 超级管理员可安全删除账号：账号会失去登录能力并匿名化，历史药品、采购和审计外键继续保留；不能删除自己或最后一个启用的超级管理员。
- 审批、改密码、撤销、废弃、删除等操作均使用系统内交互框，不再调用浏览器原生 prompt/confirm。
- 登录页提供修改密码与忘记密码入口；恢复申请、管理员审批、驳回申诉和获批重置形成完整状态流程，并绑定发起浏览器的 HttpOnly 恢复凭据。
- 面向 2 核、4 线程、6 GB 服务器优化：实时事件合并、搜索防抖与请求拆分、SQLite WAL/索引、静态资源缓存及列表查询限界。

## 环境要求

- Windows 10/11 或 Windows Server
- Node.js 22 或更新版本
- npm 10 或更新版本
- 建议仅部署在可信局域网；若暴露到更大网络，应增加 HTTPS、反向代理和登录/注册限流。

## 方法一：从 GitHub 源码部署

在 PowerShell 中执行：

```powershell
git clone https://github.com/lunncing/lab-chemical-manager.git
cd lab-chemical-manager
npm ci
npm run build
Copy-Item .env.example .env
notepad .env
npm start
```

默认访问：

```text
http://localhost:3000
```

生产进程监听 `0.0.0.0`，因此配置防火墙后，局域网其他电脑可通过服务器 IPv4 地址访问：

```text
http://<服务器IPv4地址>:3000
```

## 方法二：使用 GitHub Release 部署包

从 GitHub Releases 下载：

```text
lab-chemical-manager-v1.9.0-windows-deploy.zip
```

解压后在 PowerShell 中执行：

```powershell
cd <解压目录>
npm ci --omit=dev
Copy-Item .env.example .env
notepad .env
npm start
```

部署包已经包含编译后的服务端和用户端，不需要再次执行 `npm run build`。

## 配置文件

`.env` 示例：

```dotenv
PORT=3000
DATABASE_PATH=./data/lab-chemical-manager.sqlite
COOKIE_SECURE=false
SESSION_DAYS=7
```

说明：

- `PORT`：服务端口。
- `DATABASE_PATH`：SQLite 数据库位置。
- `COOKIE_SECURE=false`：使用普通局域网 HTTP 时保持 false；配置 HTTPS 后改为 true。
- `SESSION_DAYS`：登录会话有效天数。

`.env`、`data/`、数据库、日志、`node_modules/` 和构建缓存均不会提交到 GitHub。

## Windows 防火墙与局域网访问

首先在服务器执行：

```powershell
ipconfig
```

找到当前局域网网卡的 IPv4 地址。随后以管理员身份打开 PowerShell，允许私有网络访问 3000 端口：

```powershell
New-NetFirewallRule `
  -DisplayName "Lab Chemical Manager 3000" `
  -Direction Inbound `
  -Protocol TCP `
  -LocalPort 3000 `
  -Action Allow `
  -Profile Private
```

其他课题组成员即可访问：

```text
http://服务器IPv4地址:3000
```

不要在未配置 HTTPS、限流和额外访问控制时把端口直接暴露到公网。

### 公网部署强制安全检查

若服务器允许互联网访问，必须同时完成：

1. 在云安全组中关闭公网直连 3000，只允许反向代理或受信 IP 访问应用端口。
2. 使用 Nginx/Caddy 等反向代理提供 HTTPS，并将 `.env` 中 `COOKIE_SECURE=true`。
3. 对 `/api/auth/login` 和 `/api/auth/register` 配置按 IP 限流。
4. 创建真实超级管理员并停用全部演示账号；公开过的 `Demo1234!` 必须视为已泄露。
5. 邀请码仅发送给指定课题组成员；使用后会自动失效，未使用的邀请码可由创建人或超级管理员撤销。

邀请码不能替代 HTTPS、登录限流和云安全组访问控制。

## 首次登录与账号安全

首次初始化空数据库时会创建演示账号：

| 用户名 | 初始角色 |
|---|---|
| `teacher` | 超级管理员 |
| `admin` | 审批与普通采购人 |
| `hazard` | 审批与危险采购人 |
| `member-a` | 普通成员 |
| `member-b` | 普通成员 |

演示账号初始密码均为：

```text
Demo1234!
```

正式使用前必须：

1. 使用 `teacher` 登录。
2. 创建一个使用独立强密码的真实超级管理员。
3. 退出并确认新超级管理员可以登录和管理账号。
4. 登录新超级管理员后，在“账号管理”中删除全部演示账号；如果暂不删除，至少先停用。
5. 由“审批与普通采购人”或超级管理员进入“邀请码管理”生成邀请码。
6. 把一次性邀请码单独发送给指定成员；成员注册后邀请码自动失效。
7. 由超级管理员根据需要调整成员角色。

密码使用带随机盐的 scrypt 哈希；服务端只保存会话令牌和邀请码的 SHA-256 摘要。邀请码明文仅在生成时显示一次，自助注册不能申请管理员权限。

账号“删除”是不可逆安全删除：系统会随机化用户名和密码、清除姓名并禁止登录；数据库仅保留匿名用户 ID，以维持历史业务记录和审计外键。删除后的原用户名可以重新注册。

## 数据库与备份

默认数据库：

```text
data/lab-chemical-manager.sqlite
```

建议至少每周备份一次。最简单且安全的方法是先停止服务，再复制数据库：

```powershell
# 在运行 npm start 的窗口按 Ctrl+C
New-Item -ItemType Directory -Force D:\LabChemicalBackups
Copy-Item .\data\lab-chemical-manager.sqlite `
  "D:\LabChemicalBackups\lab-chemical-manager-$(Get-Date -Format yyyyMMdd-HHmmss).sqlite"
```

确认备份完成后重新执行：

```powershell
npm start
```

周目录归档保存在同一 SQLite 数据库中，因此数据库备份同时包含全部历史周记录。

## 从远程迁移到本地

不要在服务运行时直接复制整个部署目录。推荐在远程停止服务后迁移 `.env` 和整个 `data/` 目录，并在本地从 GitHub 重新部署程序。完整步骤、校验、切换和回滚方法见：

- [`docs/REMOTE_TO_LOCAL_MIGRATION.md`](docs/REMOTE_TO_LOCAL_MIGRATION.md)

## 更新版本

源码部署更新：

```powershell
# 先停止服务并备份数据库
git pull --ff-only
npm ci
npm run build
npm test
npm start
```

Release 部署更新：

1. 停止旧服务并备份 `data/lab-chemical-manager.sqlite`。
2. 解压新版部署包到新目录。
3. 把旧数据库复制到新版的 `data/` 目录。
4. 复制并检查 `.env`。
5. 执行 `npm ci --omit=dev` 和 `npm start`。

数据库升级均采用向后兼容的增量建表与幂等回填；V1.9 会把旧酸柜位置 `C` 自动迁移为 `C1`，并为既有药品及代入库记录增加空 CAS 字段。仍应在更新前停止服务并备份整个 `data/`。

## 开发与验收

```powershell
npm run dev
npm test
npm run lint
npm run build
npm run acceptance
```

V1.9.0 当前验证结果：58 个测试文件、207/207 自动测试、TypeScript 检查、生产构建、完整 acceptance 和性能基准均通过。性能数字来自当前开发机，只作为回归基线，不代表目标服务器等效结果。本次交付是生产实现及 TDD 证据，未执行独立 DSH 审查，也不沿用旧版本的审查结论。

## 目录

```text
client/          React + Vite 用户端
server/src/      Express、Socket.IO、SQLite 与领域路由
server/test/     HTTP、权限、事务与实时集成测试
server/scripts/  acceptance 和数据库升级验证脚本
shared/          客户端/服务端共享类型与校验
docs/            架构和 TDD 证据
```
