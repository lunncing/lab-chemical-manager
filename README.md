# 李少锋课题组药品管理系统

面向实验室局域网的药品库存、代入库、采购审批、采购执行、消息与审计系统。一个 Node.js 进程同时提供 Express API、Socket.IO 实时更新和 React 用户端，数据保存在本机 SQLite。

当前版本：**V1.5.0**

## 主要功能

- A 常温柜、B 冷藏柜各 5 层，C 酸柜单层且明确标注“仅酸性物质”；支持入库、调动、废弃、搜索与历史追溯。
- 普通入库固定当前账号；代入库需要目标人员同意，支持拒绝和发起人撤销。
- 普通成员、审批与普通采购人、危险品采购人、超级管理员四类权限。
- 普通/加急采购申请、待审批、待采购、已采购和角色化任务数量。
- 危险品与非危险品采购目录及采购完成权限隔离。
- 普通非危险品按北京时间周一至周日归档，可查看本周和历史周；已采购记录仍留在原周。
- 个人消息、通知类别/已读筛选、通知偏好、全员可见改动日志。
- Socket.IO 实时同步；服务端权限检查、乐观版本冲突和事务化审计。
- 自助注册仅创建普通成员；管理员角色只能由超级管理员授予。

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
lab-chemical-manager-v1.5.0-windows-deploy.zip
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

## 首次登录与账号安全

首次初始化空数据库时会创建演示账号：

| 用户名 | 初始角色 |
|---|---|
| `teacher` | 超级管理员 |
| `admin` | 审批与普通采购人 |
| `hazard` | 危险品采购人 |
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
4. 停用所有演示账号。
5. 让课题组成员自行注册普通成员账号，或由超级管理员创建账号并分配角色。

密码使用带随机盐的 scrypt 哈希；服务端只保存会话令牌的 SHA-256 摘要。自助注册不能申请管理员权限。

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

数据库升级均采用向后兼容的增量建表与幂等回填；仍应在更新前保留备份。

## 开发与验收

```powershell
npm run dev
npm test
npm run lint
npm run build
npm run acceptance
```

V1.5.0 当前验证结果：84/84 自动测试、TypeScript 检查、生产构建、完整 acceptance 和 DSH 独立审查均通过。

## 目录

```text
client/          React + Vite 用户端
server/src/      Express、Socket.IO、SQLite 与领域路由
server/test/     HTTP、权限、事务与实时集成测试
server/scripts/  acceptance 和数据库升级验证脚本
shared/          客户端/服务端共享类型与校验
docs/            架构和 TDD 证据
```
