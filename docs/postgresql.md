# PostgreSQL 数据库与部署

应用运行时只支持 PostgreSQL。`DB_TYPE=sqlite` 会报错，不会隐式创建 SQLite 空库。SQLite 仅用于一次性读取旧数据；旧文件保留作迁移前备份，不再参与正常读写。

## 独立环境配置

本地将 `.env.example` 复制为 `.env`，填写连接参数后启动。服务器将相同字段放在发布目录之外的私有文件，例如 `/etc/pm-system/production.env`，权限设为 `0600`。真实配置文件及加密密钥不提交 Git；更新代码不会替换服务器配置。应用和所有管理命令共用 `readDatabaseConfig`。

```dotenv
DB_TYPE=postgres
DB_HOST=postgres.example.internal
DB_PORT=5432
DB_DATABASE=pm-system
DB_USERNAME=pm-system
DB_PASSWORD=replace-in-private-runtime-file
DB_SCHEMA=public
DB_SSL=false
CREDENTIAL_KEY_PATH=/app/data/credentials.key
NODE_ENV=production
APP_ORIGIN=https://projects.example.com
```

上述为占位示例。开发和生产应使用独立数据库或明确隔离的实例。`DB_HOST` 是应用进程能访问到的地址；容器内的 `127.0.0.1` 指容器本身，不是宿主机。服务端数据库需要预先存在，数据库账号需要在选定 schema 建表及读写的权限。应用不会创建数据库或数据库账号。

需要 TLS 时设置 `DB_SSL=true`，证书由系统可信 CA 验证；私有 CA 可通过 `DB_SSL_CA_FILE` 指定。不要用关闭证书校验代替正确 CA。配置里没有密码默认值，连接失败会明确失败。

程序通过 `dotenv/config` 加载 `.env`。已注入的环境变量优先；独立运行服务器和 CLI 时可使用 `DOTENV_CONFIG_PATH=/etc/pm-system/production.env` 选择私有配置文件。仅命名为 `.env.production` 不会自动切换。

Docker Compose 在启动时读取 `PM_ENV_FILE` 指定的文件：

```bash
PM_ENV_FILE=/etc/pm-system/production.env docker compose up -d --build
```

Compose 仅固定容器监听 `HOST=0.0.0.0`、`PORT=3001`；数据库参数、`NODE_ENV` 和 `APP_ORIGIN` 由文件提供。默认只绑定宿主机回环端口，可用 `PM_HTTP_PORT` 调整；正式站点通过受控 HTTPS 反向代理访问。持久卷 `/app/data` 保存加密密钥与本地备份，数据库位于配置的 PostgreSQL 服务。数据库和 Web 配置不要使用 `VITE_*` 变量。

## 新建环境与现有数据

全新数据库可运行 `npm run db:migrate` 建立结构，再用 `user:create` 配置账号。`setup:local` 仅用于空的开发数据库；已有工作区时拒绝添加演示数据，生产模式禁止使用。迁移已有数据后保留原登录账号及密码哈希，不需要重新建立演示账号。

正常结构迁移位于 `apps/api/migrations-postgres`。事务绑定同一 PostgreSQL 连接，保留冲突与幂等保护。测试应使用随机隔离 schema，不使用正式 schema；测试结束仅清理自己创建的测试 schema。

## SQLite 一次性迁移

迁移工具位于 `apps/api/src/migrate-sqlite.ts`，先执行只检查模式，明确指定 `--apply` 后才导入：

```bash
npm run db:import-sqlite -- --source data/project-manage.sqlite
npm run db:import-sqlite -- --source data/project-manage.sqlite --apply --backup-directory data/backups
```

连接、数据库版本与 schema 的只读检查可运行 `npx tsx apps/api/src/check-database.ts`。

迁移前停止旧应用写入，保留一致 SQLite 快照与相邻的原始 `.credentials-key` 文件。目标库必须为空；工具不会清空目标已有业务数据。导入在事务内完成，保留各表主键、账号密码哈希、原始活动顺序和通知游标、附件、AI 会话及加密配置，逐表校验数量与内容并修正 PostgreSQL 序列。

`CREDENTIAL_KEY_PATH` 指向持久保存的原密钥。迁移时复制原密钥，不生成新密钥替代已有密文的密钥。更换密钥会使已有 AI/企业微信配置无法解密。旧 SQLite `migrations` 记录不替代 PostgreSQL 自身的结构版本记录。

导入后检查项目、任务、活动、成员、资料和凭据功能；确认新服务连接目标库后再恢复业务写入。导入不是服务器发布操作。切换后产生的新写入仅存在 PostgreSQL，不能直接退回旧 SQLite 文件而保留这些新数据。

## 备份与恢复

`npm run db:backup -- /private/backups/pm-system.dump` 使用当前运行配置调用 `pg_dump --format=custom`，生成一致数据库快照；凭据密钥存在时同时复制为相邻的 `.credentials-key` 文件。输出和密钥文件权限为 `0600`，拒绝覆盖已有备份或写入 Web 公开目录。密码通过子进程环境传递，不放在命令参数中。

运行机器需安装 `pg_dump` 和 `pg_restore`，客户端主版本应不低于服务器版本。容器通过 PostgreSQL 官方签名软件源安装客户端 17，匹配当前 PostgreSQL 17 服务端；后续升级数据库主版本时同步升级客户端。本机装有多个客户端时，将 PostgreSQL 17 的 `bin` 目录放在 `PATH` 前面。备份后用 `pg_restore --list` 检查归档可读；这不等同于完成恢复演练。

恢复应先在独立空库进行：注入目标库的 `PGHOST`、`PGPORT`、`PGDATABASE`、`PGUSER`、`PGPASSWORD` 等私有连接配置后，执行 `pg_restore --no-owner --no-acl --exit-on-error --single-transaction --dbname="$PGDATABASE" /private/backups/pm-system.dump`。同时恢复原密钥到该环境的 `CREDENTIAL_KEY_PATH`。检查表计数、外键和业务功能后，再安排正式恢复。

工作区 JSON 导出不是全库备份，不包含完整账号、会话与所有内部配置。历史 SQLite 文档中的复制 `.sqlite`、WAL 或 SQLite backup 命令只适用于迁移前旧版本；当前运行环境按本文使用 PostgreSQL 工具。

## 验证边界

功能验证覆盖配置选择、数据库迁移与读写、事务回滚、账号和项目任务操作。没有要求执行性能测试。实际已执行的测试与导入结果应以本次终端验收记录为准，本文不将未执行的检查写作已通过。

## 本次验证（2026-10-29）

- 构建和类型检查通过。全量功能测试 953 项中 952 项首次通过；50 MB 附件用例因网络读写超出原 30 秒等待限制，调整等待时间后单独复验通过。新增读取一致性及相关历史、项目状态测试 29 项通过。
- 在隔离 PostgreSQL schema 中验证登录、项目任务、连续对话、归档、通知逻辑、文件保存、导入和备份恢复。未执行性能测试，也未调用真实 AI 或发送企业微信消息。
- 实际 SQLite 源库 37 张表、1,653 条记录已完整导入 PostgreSQL 17.9，逐表数量与内容校验通过；旧版本缺少的 wecom_login_sessions 保留为空表。迁移报告及一致备份存于本机私有 data 目录，原凭据密钥已保留并验证解密成功。
- 本地项目已使用 PostgreSQL 启动；健康接口及 /projects 页面访问通过。Docker 镜像与远端 CI 尚未实际运行。
