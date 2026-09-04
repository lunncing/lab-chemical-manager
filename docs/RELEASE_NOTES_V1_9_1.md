# V1.9.1 发布说明

## 权限修复

- 任意已登录且启用的 `member`、`normal_admin`、`hazardous_buyer` 或 `super_admin` 均可更正任意活跃药品，不再按归属人或 A1 等存储位置分支。
- 所有登录角色都会在活跃药品详情中看到“更正信息”；已废弃药品仍不显示该操作，服务端仍返回 409。
- 未登录请求仍返回 401；严格请求 schema、允许更正的四类字段、CAS 清空、乐观版本、no-op 400、事务回滚和 commit 后实时事件规则保持不变。
- 更正审计继续记录字段级 before/after，actor 始终是实际执行操作的登录账号，不会冒充药品归属人；公开接口与实时事件仍只暴露摘要。

## 依赖安全修复

- 保持 `express@5.2.1` 和 `body-parser@2.3.0`，把二者共用的间接依赖 `qs` 从 6.15.3 更新至 6.16.0，修复 GHSA-x5fp-wj9c-mxmx 与 GHSA-4mjr-xmp4-gh2g。
- `qs` 没有成为项目直接依赖，`package.json` 未改变；`package-lock.json` 只更新 `node_modules/qs` 的 version、resolved 和 integrity 三个字段。
- 升级前 production audit 为 1 个 moderate，升级后所有严重级别均为 0；原始 JSON 分别保存在 `docs/npm-audit-v1.9.1-before.json` 和 `docs/npm-audit-v1.9.1-after.json`。

## 账号删除语义修正

- 超级管理员删除账号时，不再把 `users.display_name` 覆盖成“已删除用户 #ID”。原姓名继续显示在历史药品归属人和入库操作人、库存调动、采购、代入库双方、邀请码创建人及公开审计 actor 中；现有查询继续通过 `users` 外键读取姓名，不新增快照列或数据库迁移。
- 登录身份仍不可逆移除：原用户名替换为随机唯一墓碑值，密码替换为不可知随机密码的 scrypt 哈希，`active=0`、`demo=0`、`deleted_at`、版本和更新时间规则不变；会话、个人通知及通知偏好仍在同一事务中删除，原用户名仍可供新成员注册。
- DELETE API、`user:changed` 实时事件和删除审计改用 `login_identity_removed_display_name_retained` mode；事件仍只包含安全的 `{id, mode}`。删除审计不写入真实姓名，界面明确提示“登录身份删除、历史姓名保留”，不再宣称完全匿名化。
- 仅超级管理员、自删禁止、最后一个启用超级管理员保护、重复/并发删除、历史外键和用户名复用保护均保持不变。
- 已由旧版本覆盖成“已删除用户 #ID”的姓名没有可靠恢复来源；本版本不会猜测、迁移或伪造这些姓名，原占位值保持不变。

## 验证

- 测试先记录权限 focused RED：非归属 member 的 A1 API 请求返回 403，且 member / normal_admin / hazardous_buyer 的客户端权限矩阵和按钮渲染失败；最小修复后 focused UI/API/native-dialog 测试为 3 文件、14 项全部通过。
- 账号删除先记录 2 文件、3 项失败的 focused RED：旧实现覆盖用户行姓名，药品、调动、采购、代入库、邀请和审计查询均随之显示“已删除用户 #ID”，删除 Modal 仍声称匿名化；最小修复后同一组 2 文件、10 项测试全部通过。
- `npm ci`、`npm ls express qs --all` 与 `npm audit --omit=dev --json` 通过；Express 和 Body Parser 均解析到同一个 `qs@6.16.0`，production vulnerability 总数为 0。
- 全量测试 58 文件、210 项全部通过；lint、生产构建（82 modules）、acceptance（74 条审计记录）、性能 benchmark 和生产 bundle 守卫全部通过。
- benchmark 使用临时 WAL 数据库和系统分配端口：health/audit/purchases p95 分别为 16.21/16.80/16.91 ms，20 并发错误为 0，RSS 为 93.27 MB。
- 生产 bundle 包含“更正信息”、登录凭据移除警告和历史姓名保留成功文案，不含“匿名化”文案，原生 `prompt`/`confirm` 调用为 0。验证没有启动或接触端口 3000，没有访问持久数据库。
- DSH 使用 `codex/gpt-5.6-sol` 完整读取并审查全部 16 个变更文件、完整 lockfile 和关键未变调用方，最终结论为 `PASS`。
- 用户在临时 3194 候选中完成 A1 跨归属更正与删除后历史姓名显示验收，并确认“通过”；候选随后关闭，本机 3000 始终保持关闭。
