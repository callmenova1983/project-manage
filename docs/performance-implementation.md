# 工作区性能优化：实现与本地验收

更新：2026-11-03。按本次确认，仅完成本地实现、隔离数据库验证和必要浏览器流程；不连接、测试或发布服务器。原计划的 1／5／10 用户压力矩阵、每场景 30 次采样不执行。所有生产 p95 数字仍是待验收目标。

## 已实现的调用链

- 已登录启动：`GET /api/bootstrap` 在同一读取快照中返回 actor、CSRF、完整项目与任务、基础字典、时区、成员标签、排序、关注 ID 及同步版本。首屏不读取活动历史、完整通讯录、项目成员关系。
- 核心刷新：`GET /api/workspace/core?knownVersion=…` 相同版本只返回 `{version, unchanged:true}`。原 `/api/workspace` 与写入响应继续保留。
- 历史：过滤、游标、排序、LIMIT 在 SQL 中执行；汇总计数、项目数、完成动作与按时区分日统计单独聚合。新增 `occurred_at` 保留原文本时间；本地 EXPLAIN 验证使用 `activity_page_instant` 索引。
- 撤销：`POST /api/activity/receipts` 按实体种类、ID、保存版本批量读取；最多每批 200 个实体。回执按时间从新到旧返回，避免导入历史复用实体版本时选中旧记录。回执未取得时仍显示同步状态，可手动重试。
- 普通保存：先合并服务器确认的实体并结束保存等待；回执与核心校准在后台执行。批量返回实体同样即时合并，跨实体变更由条件快照校准；冲突、幂等和原有写事务锁保留。
- 按需资源：通讯录在团队页／人员选择器打开时加载，项目成员在详情／选择器中加载。核心、通讯录、成员、回执、通知、Token 用量分别保存；未变化项目、任务和分组保留引用。
- 日期计算：项目页、全局统计和每周变化使用工作区时钟，不再依赖重复下载数据刷新日期。
- 懒加载：任务、详情、活动、设置、管理路由；项目／任务编辑器、AI 录入内容、文件预览改为条件加载。本轮保留原列表布局。

实现入口：`packages/domain/workspace-sync.ts`、`apps/api/src/workspace-sync.ts`、`apps/web/src/services/workspace-sync.ts`、`apps/web/src/stores/workspace.ts`。

## 实时同步与后台通知

`workspace_sync_versions` 为 core、directory、projectMembers、notifications、usage 保存独立版本，业务 `revision` 保持原语义。数据库触发器覆盖实体、字典、成员、通知和用量写入，同一事务、同一范围只推进一次版本；事务回滚同时撤销版本、通知任务和 NOTIFY。

API 使用独立 PostgreSQL LISTEN 连接，不占用查询池。SSE 按工作区／用户转发范围与版本提示，内部任务调度事件不会发给浏览器。监听连接故障自动重连。SSE 每 15 秒心跳并复查会话；服务关闭时释放连接。同源 Cookie 认证，客户端隐藏、退出和账号切换时关闭流。请求还携带账号标识，Cookie 被其他标签页换成另一账号时拒绝旧页面请求。

客户端将 150 ms 内的提示合并为一次元数据校准；同一范围单请求在途，期间出现新版本再补取。数据应用完成才确认版本。正常连接每 60 秒校准；失效时每 2 秒检查版本，错误退避至最多 30 秒。持久化版本修复漏事件，SSE 不承诺事件重放。认证后 API 按账号限流，登录仍按 IP 限流，避免办公室共享出口挤占同步额度。

`PM_BACKGROUND_NOTIFICATIONS=1` 时，业务事务只入队。`notification_jobs` 合并工作区待办，保存目标序号、租约和租约令牌；提交提示立即唤醒，1 秒扫描兜底。处理在独立短事务内进行，保留当前全局写锁；失败回滚、租约过期后恢复，删除任务同时检查租约令牌及目标序号。导入／撤销抑制信息绑定原活动记录，合并批次后仍可辨别。

通知 GET 只读取状态；原 15 秒定时提醒检查与外部投递规则保留。通知内容变化、稍后提醒到期会推进用户通知版本。无变化 upsert 不再改写通知。外部企业微信发送仍使用既有 outbox 去重、失败和结果不明规则，测试使用模拟投递。

浏览器演示适配器实现同样的读取契约，通过本地事件、storage 事件和本地版本校准，保持数据存放在浏览器中。

## 配置与独立开关

| 配置 | 默认 | 作用与回退 |
|---|---|---|
| `VITE_WORKSPACE_CORE` | 开启，示例值 `1` | `0` 使用完整快照和原 20 秒轮询；需重新构建前端 |
| `VITE_WORKSPACE_SSE` | 开启，示例值 `1` | `0` 不建立 SSE，仍用轻量版本轮询；需重新构建前端 |
| `PM_SSE` | 开启，示例值 `1` | `0` 关闭 SSE 路由，客户端自动降级 |
| `PM_BACKGROUND_NOTIFICATIONS` | **关闭，示例值 `0`** | `1` 开启后台任务；`0` 保留写请求内同步推导，后台任务消费关闭 |
| `PM_PERFORMANCE_LOG` | 关闭 | `1` 输出路由、状态、认证／数据库／组装耗时、查询数及序列化响应字节，不记录请求正文和凭据 |

原生构建可用 `VITE_WORKSPACE_CORE=0 VITE_WORKSPACE_SSE=0 npm run build` 回退。Dockerfile 和 Compose 已传递这两个构建参数；也可使用 `docker compose build --build-arg VITE_WORKSPACE_CORE=0 --build-arg VITE_WORKSPACE_SSE=0`。`PM_ENV_FILE` 是运行时文件，单独修改其中的 VITE 变量不会改变已构建的前端。

后台通知采用显式启用，便于分阶段发布。本地浏览器及新后台任务测试使用 `PM_BACKGROUND_NOTIFICATIONS=1`。同一部署的 API 实例必须统一该值；切换时先停止旧实例，再按统一模式启动，不能同时运行两套业务通知推导机制。定时提醒检查在两种模式下均保留。

`Server-Timing` 默认提供 auth、db、app、assembly、total。db 包含认证查询，assembly 是核心读模型的非 SQL 耗时（包括连接／事务开销），这些子项存在包含关系，不应相加作为总时长。实际网络传输字节以 Nginx 或浏览器记录为准。

## 数据库迁移

新增 `apps/api/migrations-postgres/002_workspace_sync.sql`，没有删除既有列或数据：

1. 创建同步版本、持久化通知任务、活动抑制关联表及触发器。
2. 给现有工作区初始化版本和通知任务。
3. 为活动新增时间列，回填、校验非空，再建立时间分页和实体回执索引。

仍由现有迁移机制在事务中应用并校验 checksum。固定 schema 的 `search_path` 仅在新建池连接首次使用时设置；普通借用不再重复执行。完整快照复用项目列表及通讯录，减少重复查询。

回退使用本版本开关和兼容接口，保留新增结构。不要直接用缺少 002 文件的旧二进制启动：现有严格迁移校验会拒绝它；不要删除迁移记录、改 checksum 或删除新增表。对于历史量远大于本地样本的部署，回填和索引建立时间需在发布前按实际数据评估。

## Nginx 交付配置

- `deploy/nginx/performance-http.conf`：在 `http {}` 层合并，gzip 等级 5，最小响应 1 KB，JSON／JS／CSS／SVG，`Vary: Accept-Encoding`；日志包含请求／上游耗时、发送字节及 gzip 比例，日志 URI 不包含查询参数。
- `deploy/nginx/performance-server.conf`：合并现有 TLS 站点，启用 HTTP/2；SSE 路由关闭代理缓冲、缓存及 gzip，读取超时 60 秒。示例上游为 `127.0.0.1:3001`，按现有映射调整。
- Fastify 给带 hash 的 `/assets/` 文件设置一年 immutable；HTML 与业务 API 继续 no-store，其他资源保留原缓存行为。

保留原站点的证书、域名、认证和代理头配置，不整份替换站点文件。未来由部署方备份配置，合并片段，执行 `nginx -t` 后 reload；验证响应头及 SSE 心跳。回退时恢复原配置并再次 `nginx -t`、reload。本次没有执行服务器配置检查、带宽核查或 Nginx reload。

推荐发布顺序仍是：配置 → 兼容后端和迁移 → 新前端 → SSE → 后台通知。可分别关闭开关核对收益。

## 本地必要验证

环境：Node 24.22.2、PostgreSQL 16.13（本机）、独立随机 `pm_test_*` schema、Chrome。测试结束清理各自 schema，不写业务 schema。

- 12 个相关单元／集成测试文件，117 项通过：既有 API 冲突、幂等、导入、历史恢复；历史 SQL 与原统计语义；通知投递规则、稍后提醒到期版本；新启动契约、未变化响应、回执顺序、事务回滚、SSE 提交提示、漏事件恢复、任务租约恢复；同步合并、账号切换与请求令牌恢复；日期和中文／拼音搜索。
- 3 项浏览器测试通过：演示模式完成／历史／撤销，正式模式并发修改阻止旧版本撤销，以及轻量启动、双客户端更新、阻断 SSE 后降级恢复、搜索。
- 类型检查、生产构建、变更文件 ESLint 通过。构建仍提示地图和 Office 预览等异步包超过 500 KB；它们按路由／打开预览加载，本次未改写这些依赖。
- 调整两处旧测试：迁移测试现在读取所有已应用迁移的 checksum；撤销测试明确切回项目列表检查列表统计，再回变化页检查历史，修正原先查询非当前页面元素的问题。

浏览器一次本地样本：保存 API 响应 **9 ms**，提交成功到另一客户端显示 **241 ms**，搜索输入到断言结果 **32 ms**。未限速，包含测试框架开销，仅作功能及方向检查，不是 p95。

复现浏览器时使用项目现有 Playwright 配置与本地 PostgreSQL 环境变量，执行：

```sh
PM_BACKGROUND_NOTIFICATIONS=1 npx playwright test \
  tests/e2e/workspace-sync.spec.ts tests/e2e/interaction-feedback.spec.ts \
  --grep 'lightweight startup|completion links counts.*1536px|formal undo'
```

## 本地数据传输样本

`scripts/performance-smoke.ts` 自动建立、清理随机隔离 schema，只允许 localhost PostgreSQL。生成 **167 项目、212 任务、500 活动**的合成数据，接口各取 5 次暖样本。gzip 字节用等级 5 计算，不代表已验证 Nginx 网络传输；小于 1 KB 的结果实际按配置不压缩。

| 接口 | 响应原文 | gzip 计算值 | 本地中位数 | 最大值 |
|---|---:|---:|---:|---:|
| 完整快照 | 659,120 B | 27,116 B | 6.21 ms | 6.31 ms |
| bootstrap | 174,433 B | 8,206 B | 2.32 ms | 5.23 ms |
| core | 174,129 B | 8,032 B | 2.25 ms | 2.42 ms |
| core 未变化 | 32 B | 不压缩 | 0.51 ms | 0.60 ms |
| meta | 83 B | 不压缩 | 0.31 ms | 0.34 ms |

样本中核心响应原文约减少 74%。合成文本重复程度与真实历史不同，不能把这里的压缩比直接套到此前线上 1.19 MB 样本。接口计时使用 Fastify 本地注入，不包含公网、TLS、Nginx、浏览器解析和页面渲染。

复现：使用项目要求的 Node 24，设置本机 PostgreSQL 的 `DB_HOST`、`DB_DATABASE`、`DB_USERNAME`、`DB_PASSWORD`，然后运行 `npx tsx scripts/performance-smoke.ts`。脚本拒绝远程数据库，输出 `artifacts/performance/local-smoke.json`，其中包含活动分页 `EXPLAIN ANALYZE`。浏览器样本附在 Playwright 报告内。

仍未验证：3 Mbps／100 ms 网络下的首次可操作 p95、真实业务数据 150 KB 压缩预算、10 并发和生产通知时延，以及实际 Nginx／HTTP/2／服务器出口表现。按本次收窄后的范围，这些保留为部署后的验收目标。
