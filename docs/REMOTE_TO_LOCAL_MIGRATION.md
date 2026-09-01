# 从远程服务器迁移到本地服务器

本文适用于李少锋课题组药品管理系统 V1.8.0。目标是把远程服务器上的**真实业务数据和配置**安全迁移到一台本地 Windows 电脑，同时保留可回滚的远程副本。

## 结论

不要在服务运行时直接复制整个部署目录，也不要把远程服务器的 `node_modules` 原样搬到本地。

推荐拆成两部分：

1. **程序代码**：本地从 GitHub Release 或 Git 仓库重新部署；
2. **私有状态**：远程服务停机后，只迁移 `.env` 和整个 `data/` 目录。

`data/lab-chemical-manager.sqlite` 包含账号、药品、采购申请、审批、通知、日志和周归档，是迁移中最重要的文件。`.env` 可能包含部署参数，不得上传到 GitHub。

## 一、迁移前准备

本地电脑需要：

- Windows 10/11 或 Windows Server；
- Node.js 22 或更新版本；
- npm 10 或更新版本；
- 足够的磁盘空间；
- 固定或长期不变的局域网 IPv4 地址更便于课题组成员访问。

先在本地 PowerShell 检查：

```powershell
node --version
npm --version
ipconfig
```

记录远程服务器当前访问地址、数据库路径和端口。迁移窗口内暂停入库、调动、废弃、审批和采购操作，避免用户在切换期间继续写入旧服务器。

## 二、在远程服务器上制作一致性备份

### 1. 停止应用

若服务器是在终端中用 `npm start` 启动的，在对应窗口按 `Ctrl+C`。若使用进程管理器或系统服务，则通过原来的管理方式停止服务。

停止后确认旧地址已不能继续提交业务操作。

### 2. 复制私有状态

在应用目录中备份：

```text
.env
data/
```

应复制**整个 `data/` 目录**，不要只在运行中单独复制 `.sqlite`。系统使用 SQLite WAL 模式；如果目录中存在以下文件，也必须作为同一组一起保留：

```text
lab-chemical-manager.sqlite
lab-chemical-manager.sqlite-wal
lab-chemical-manager.sqlite-shm
```

正常停机后，WAL 通常会被合并，但保留整个目录可以覆盖异常关闭场景。

不要复制或上传：

```text
node_modules/
client/dist/（源码部署时可重新构建）
server/dist/（源码部署时可重新构建）
日志文件
Git 凭据
```

### 3. 计算校验值

在远程 Windows PowerShell 中可执行：

```powershell
Get-FileHash .\data\lab-chemical-manager.sqlite -Algorithm SHA256
```

记录哈希值。迁移后在本地对同一文件再次执行，确认传输前后完全一致。

## 三、把备份传到本地

可使用 WinSCP、SFTP、受控共享目录或移动硬盘。传输内容仅限：

```text
.env
data/
```

数据库和 `.env` 都是敏感文件，不应通过公开网盘链接、公开 GitHub 仓库或普通聊天群传输。

## 四、在本地部署程序

### 方案 A：从 GitHub 源码部署

```powershell
New-Item -ItemType Directory -Force D:\LabChemicalManager
Set-Location D:\LabChemicalManager
git clone --branch v1.8.0 https://github.com/lunncing/lab-chemical-manager.git app
Set-Location .\app
npm ci
npm run build
```

把远程备份的 `.env` 和整个 `data/` 目录复制到 `D:\LabChemicalManager\app\`。检查 `.env`：

```dotenv
PORT=3000
DATABASE_PATH=./data/lab-chemical-manager.sqlite
COOKIE_SECURE=false
SESSION_DAYS=7
```

如果本地仍通过普通局域网 HTTP 访问，`COOKIE_SECURE=false`；如果本地配置了 HTTPS，则使用 `COOKIE_SECURE=true`。

启动：

```powershell
npm start
```

### 方案 B：使用 V1.8.0 Release 部署包

从 GitHub Releases 下载 `lab-chemical-manager-v1.8.0-windows-deploy.zip`，解压到 `D:\LabChemicalManager\app`，然后：

```powershell
Set-Location D:\LabChemicalManager\app
npm ci --omit=dev
```

复制远程 `.env` 和整个 `data/` 目录后执行：

```powershell
npm start
```

部署包已包含编译结果，不需要再次运行 `npm run build`。

## 五、验收本地服务器

先在本地浏览器打开：

```text
http://localhost:3000/api/health
```

应返回：

```json
{"status":"ok"}
```

然后打开：

```text
http://localhost:3000
```

至少核对：

1. 老师和普通成员账号可以正常登录；
2. A/B/C 柜药品数量和位置与迁移前一致；
3. 采购申请、待审批、待采购和历史周目录数量一致；
4. 消息、改动日志和密码恢复记录可见；
5. 新建一条临时测试数据后能实时刷新；测试完成后按业务流程撤销或废弃，不直接改数据库；
6. 重启一次 `npm start` 后数据仍然存在。

再计算本地数据库哈希：

```powershell
Get-FileHash .\data\lab-chemical-manager.sqlite -Algorithm SHA256
```

如果应用首次启动执行了数据库迁移或写入，哈希可能变化；因此哈希对比应在**首次启动前**进行。启动后的业务一致性用上述页面核对。

## 六、切换课题组访问地址

本地服务器监听 `0.0.0.0:3000`。以管理员身份打开 PowerShell，仅允许私有网络：

```powershell
New-NetFirewallRule `
  -DisplayName "Lab Chemical Manager 3000" `
  -Direction Inbound `
  -Protocol TCP `
  -LocalPort 3000 `
  -Action Allow `
  -Profile Private
```

成员使用：

```text
http://本地服务器IPv4地址:3000
```

如果成员之前收藏的是远程公网地址，需要通知他们更换地址。建议为本地服务器设置 DHCP 地址保留或固定局域网 IP。

## 七、回滚与下线远程服务器

本地验收完成前，不要删除远程服务器文件。推荐：

1. 远程应用保持停止，避免形成两套独立数据库；
2. 保留远程只读备份至少 7 天；
3. 本地连续使用并完成一次重启、一次备份恢复演练；
4. 确认无遗漏后，再关闭远程安全组端口或释放服务器；
5. 永久保留一份迁移日数据库离线备份。

## 重要限制

- 该系统是单节点 SQLite 应用，不支持远程和本地两台服务器同时写同一个数据库。
- GitHub 只保存程序代码，不保存真实数据库、`.env`、账号、药品记录或消息。
- 迁移后应建立自动备份；“本地化”不会自动带来容灾能力。
- 若本地电脑休眠、关机、改变 IP 或断网，其他成员将无法访问。建议使用稳定供电、关闭自动休眠并配置开机自启。