# 入口、共享数据与恢复：首批交付

本文记录 `e2a1113` 的入口与恢复改进。数据库运行时现已迁移为 PostgreSQL；下面的操作指引已更新，历史测试证据仅说明原版本结果。当前部署与迁移以 [PostgreSQL 说明](postgresql.md) 为准。

## 已修复的实际代码问题

- 缺失 JS/CSS 原先也回退到 `index.html` 并返回 200。现在静态资源缺失、非文档请求和未知写入路由返回真正的 404，避免把资源发布/缓存问题隐藏成模块加载错误。
- 应用文档返回明确的 `text/html`、`Content-Disposition: inline` 和 `Cache-Control: no-store`；不使用旧 HTML 的条件请求结果。静态文件仍使用自身 MIME 类型及重新验证缓存。GET 首页有内容；HEAD 按协议无正文，不能把 HEAD 的零字节当作页面下载失败。
- Web 目录存在但 `index.html` 缺失或为空时会阻止启动；正式进程缺少构建入口时在打开数据库前报错。本地 Vite + 独立开发 API 仍可使用。
- 即使入口脚本失败，HTML 内的双语加载说明与原生重新加载链接仍可操作；不会只有一个空 `#app`。这只能处理已经收到 HTML 的场景，不能修复代理未送达页面、托管休眠或浏览器下载行为本身。
- 正式工作区回到前台或收到网络恢复事件时立即刷新快照，保留原有 20 秒轮询。脏编辑器继续保留自己的原始版本和文本；其他成员已保存的新版本会阻止覆盖。演示不会因此请求正式 API。

## 无凭据入口诊断

在能访问已批准入口的环境运行：

```bash
npm run check:entry -- https://your-approved-origin
# 仅安装生产依赖时，先使用已构建产物：
node dist/server/apps/api/src/check-entry.js https://your-approved-origin
```

输入必须是完整 HTTP(S) origin，不含路径、查询、片段或账号密码。诊断只 GET `/projects`、`/demo/projects`、`/api/health` 和首页引用的本站编译 JS/CSS；不登录、不发送 Cookie、不写项目、不调用模型、不跟随重定向。每次请求 10 秒超时，正文读取上限 2 MiB。输出状态码、内容类型、字节数和问题分类，不保存正文、Cookie、密钥或重定向查询参数。全部符合条件时退出码 0，否则 1。

桌面/手机 User-Agent 是响应探测，**不是**真实 Safari/iOS、登录或多设备通过。私有端口跳转到身份验证站点时，诊断会停在重定向并提示维护者检查；不要为此关闭认证或改为公开端口。使用已配置出口代理的 Node 环境，可由操作方采用 `node --use-env-proxy` 运行同一个编译脚本；脚本不自行更改代理配置。

| 观察                                                    | 含义与下一步                                                                       |
| ------------------------------------------------------- | ---------------------------------------------------------------------------------- |
| 200 HTML、有正文、inline，JS/CSS 类型正确               | 入口响应基本正常；继续由测试者私下登录和操作                                       |
| `empty-get-response` / `attachment-instead-of-web-page` | 分别保留应用端与转发端的安全响应元数据，检查发布产物/响应改写；不猜测为密码问题    |
| 模块 URL 返回 HTML 或 404                               | 检查构建产物是否完整、发布是否混入不同版本；重新加载最新入口，不让未知资源返回首页 |
| 301/302 等重定向                                        | 人工检查目标来源及私有入口的登录要求；诊断不跟随，不复制含 token 的 URL            |
| 网络/超时或出口 CONNECT 拒绝                            | 请求可能尚未到达服务；先区分执行环境出口、托管平台与应用，不能据此认定应用休眠     |

2026-10-13，本执行环境对仓库中既有 Codespaces 地址的只读检查未获得应用 HTTP 响应；经本环境出口代理的 curl 请求返回 **`CONNECT tunnel failed, response 403`**。这是出口/隧道层阻碍，不能作为应用返回 403、服务已停止或 iOS 0 KB 已复现的证据。未尝试绕过代理、更改端口可见性或登录真实账号。需要环境所有者在允许访问该入口的环境执行上述诊断，再做真实手机登录验证。

## 一致性备份与独立恢复

所有命令读取与运行服务相同的 `DB_*` 配置。服务器配置在发布目录之外时，指定 `DOTENV_CONFIG_PATH`：

```bash
DOTENV_CONFIG_PATH=/etc/pm-system/production.env npm run db:backup -- /private/backups/before-upgrade.dump
# 仅安装生产依赖时使用构建产物：
DOTENV_CONFIG_PATH=/etc/pm-system/production.env node dist/server/apps/api/src/backup-cli.js /private/backups/before-upgrade.dump
```

工具使用 `pg_dump` 创建一致 PostgreSQL 自定义归档，用 `pg_restore --list` 检查归档可读，并一同保存原凭据密钥。文件权限为 `0600`；已有目标和 Web 公开目录会被拒绝。归档可读不等于恢复演练通过。

先在独立空数据库恢复，再检查表计数、外键、登录和项目任务功能。恢复数据库及相邻密钥作为同一组管理；正式切换前保留新产生的数据，避免用旧备份覆盖后续写入。详细命令见 [PostgreSQL 备份与恢复](postgresql.md#备份与恢复)。

## 原版本历史验证范围与证据

以下数字和 SQLite/WAL 恢复证据属于原版本，不作为 PostgreSQL 切换验收结果。当前 `scripts/smoke-built.mjs` 使用随机 PostgreSQL schema，验证成员会话、进程重启持久化和归档可读；独立恢复在结果中明确标为未运行，须单独演练。

自动化新增：文档 GET/HEAD/MIME/缓存、空构建启动拒绝、资源 404、公开健康与私有 API 边界；诊断的无凭据、重定向、敏感内容不落报告、资源错配与超时；WAL 一致性备份、完整性、独立恢复、禁止覆盖和公开目录；两名不同账号的真实 API 会话、手机前台恢复、脏文本保留及 409 冲突；无脚本和入口模块失败后的原生重载。

`scripts/smoke-built.mjs` 启动真实编译后端进程，验证两个成员共享修改、进程停止/重启、备份之后的新写入与独立快照恢复的区别，以及带正式会话进入 `/demo/` 仍不改正式数据。此脚本使用**本机 HTTP**、临时数据库和合成账号；不等于生产 HTTPS/CSP 或真实多人网络验收。生产响应头通过本地 API 测试，Codespaces Origin/Referer/Secure Cookie 仍是独立的本地重放测试。完整数量与结果见 [verification.md](verification.md)。

本地完整通过：215 项单元/API 测试、71 项 Chromium 端到端测试；lint、类型、格式、构建检查通过。两个运行报告均为 0 个意外浏览器错误。

证据：`artifacts/entry-response.json`、`artifacts/built-runtime.json`、`artifacts/codespaces-browser.json`；[深色桌面](screenshots/runtime-dark-desktop.png)、[无脚本手机入口](screenshots/runtime-entry-mobile.png)、[两成员冲突保留](screenshots/runtime-shared-mobile.png)。截图只含合成数据，已实际打开检查。冲突图包含该轮共享 API 测试新建的项目，统计随实际数据变化；桌面演示图保留 20 项目的初始统计。

## 下一批及外部依赖

- 已有首月工程验证继续向真实设备/测试环境验收推进，仍需获准且可访问的测试入口、持久磁盘/备份位置和私下登录方式；本执行端未操作真实账号。
- 真实 AI 需要批准的模型/区域、数据处理范围、有限调用/费用额度，以及所有者安全注入服务端密钥。不要在聊天发密码或密钥。本批只运行规则和模拟测试，未调用真实模型。
- 成员 ID 关联、完整周范围聚合、自由语义录入/应用内语音、后续冲突体验与规模验收仍属后续批次；不能用本批通过替代三个月计划全部完成。
