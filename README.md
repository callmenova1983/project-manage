# Project Manage

Vue 3 + TypeScript 项目协作应用，包含真实 Node/Fastify API、SQLite 数据库与迁移、认证、审计和冲突保护。默认连接后端；浏览器本地演示是可选模式。公开代码中的项目、人物和工作内容全部为合成数据。

## 快速启动

需要 Node **24.x**（验证版本 24.19.0）和 npm。依赖版本及传递依赖由 `package-lock.json` 锁定。

```bash
npm ci
npm run setup:local
npm run dev:all
```

打开 `http://localhost:4173`。登录账号与随机生成的密码保存在 **`data/local-login.txt`**（权限 0600，已被 Git 忽略）。不会创建默认弱密码。`setup:local` 只初始化空数据库，重复执行不会清空已保存的工作。

- Web：4173；API：127.0.0.1:3001，仅绑定本机。
- 数据文件：`data/project-manage.sqlite`，重启不会丢失。
- `APP_ORIGIN` 必须与浏览器来源一致。使用 `terminal.local` 或其他主机名时修改实际启动环境并重启 API（已导出的变量优先于 `.env`）。登录报 `Origin not allowed` 是来源配置问题，发生在密码校验前；[排查与无凭证验证步骤](docs/origin-troubleshooting.md)。
- 配置见 `.env.example`。不要提交 `.env`、数据库、用户导出或真实业务纪要。

**免登录体验：打开同一站点的 `/demo/`**，直接使用 20 个合成项目；项目/任务编辑保存在当前浏览器，不请求 API、不创建后端会话。正式 `/projects` 与 API 继续要求登录。[演示边界、手机拍摄和部署说明](docs/browser-demo.md)。

独立运行 Web/API：`npm run dev` / `npm run dev:api`。无后端且全站均为演示时，仍可运行 `VITE_DEMO_MODE=1 npm run dev`。同站同时提供正式工作区和 `/demo/` 时使用正常构建，不设置此变量。

## 当前功能

- **个人列映射与精简审阅**：Excel/CSV 模板按浏览器账号保存、复用和修改；按来源项目分组及待决定筛选，保留歧义确认、来源、撤销和缺字段保存。[使用与边界](docs/personal-work.md)。

- **最新性能与计划收口**：200 项目/5000 任务筛选 p95 两轮为 280.4/363.1ms，仍未达到 200ms；见 [方法、原始样本与架构边界](docs/filter-performance.md) 和 [三个月计划完成状态、未实现项及最小下一步信息](docs/plan-closeout.md)。

- **可靠性与容量验收**：五个独立会话、20 组断网/重复提交；200 项目与 5000 任务的原始测量、明确未达标项及真实环境待办见 [验收说明](docs/reliability-acceptance.md)。

- **连续文本录入**：项目标题上下文、候选匹配依据、歧义二次确认、来源与可撤销草稿；[规则边界、50 个合成评测与截图](docs/intake-context.md)。
- **工作区时区**：管理员可明确设置 Asia/Shanghai 等 IANA 时区，统一今天/本周、历史、分页和导出；保留旧日期及 UTC 默认。[使用、边界及迁移](docs/workspace-time-zone.md)。
- **完整历史与成员关联**：按工作区 IANA 时区统计完整周历史和分页明细，稳定负责人/参与者/执行人 ID、旧文本兼容和停用保留；[口径、迁移回退与截图](docs/history-members.md)。
- **入口与恢复**：明确文档/资源响应、无脚本重载提示、回到前台立即同步、无凭据入口诊断及私有一致性备份；[操作说明与验收边界](docs/runtime-entry-recovery.md)。
- **任务反馈与移动端导航**：勾选完成联动真实统计和活动、版本保护撤销、项目收起/返回焦点、近期任务滚动选择；[实现、截图和验证边界](docs/interaction-feedback.md)。
- **快速录入**：文字、CSV/TSV、Excel 工作表与列映射 → 候选审阅 → 项目/任务事务创建、来源留存和受保护撤销。[录入说明](docs/quick-intake.md)。
- **管理后台**：用户新增/启停/激活、阶段与业务分类、模型非敏感配置与调用日志；普通成员仍可编辑全部项目。[管理员配置与运行边界](docs/administration.md)。

新增中英文切换、深浅主题、阶段概览、任务状态分布、本周真实变化与近期事项。语言/主题独立持久，用户内容原样保留。[本批功能、部署和下一批范围](docs/experience-update.md)。

- 深色紧凑项目列表、横向导航与默认收起的覆盖式菜单、五生命周期阶段、独立责任维度、负责人。
- 项目详情、独立汇报时间／报告人、工作笔记行内保存／取消；组合搜索／筛选与汇报排序。普通属性编辑不会刷新事实汇报时间。
- 首页 Today／This week 切换具体任务名称、状态及各项目四状态合计；独立今日／本周／全部任务视图、任务／子任务、状态修改，工作范围与截止日期独立。
- 自由文本／表格原文行内编辑；日期候选结合上下句、目标任务与覆盖二次确认；TSV 粘贴任务、预览／校验／确认、取消和未保存离开提示。
- 会话登录、同工作区全员共享编辑、工作区间隔离；管理员可在后台建立待激活账号，服务器 CLI 仍可用于明确的本地配置。
- 保存审计、来源片段、变更前后值与单条历史恢复；活动界面查询完整数据库范围并分页，快照和工作区 JSON 导出仍为最近 500 条预览；历史页可导出同一快照的完整筛选结果（最多 10,000 条，超限明确报错）。
- 冲突返回最新版本，编辑器保留草稿供对比；20 秒轮询更新和手动刷新。
- JSON 导入/导出，替换前预览与明确确认；导入事务、关系检查和工作区 revision 检查。
- 会议纪要规则建议：逐字保留原文／空白／行号、名称及别名候选、未知/多候选人工选择、逐项确认、覆盖二次确认、应用审计和防重复。
- 加载/空/失败状态、键盘可操作、响应式布局、中英文标签与原文保留。

**默认未连接真实模型。** 规则匹配不是语义理解；不会推测负责人或日期，不会自动改项目。规则模式的源材料只留在应用数据库/本地演示。可选 Qwen 服务端适配须安全配置、额度授权及发送确认后才会将纪要和项目匹配信息发送到供应商，返回结果仍需人工确认。

## 示例数据与统计口径

`packages/domain/seed.ts` 是唯一合成种子源，首次初始化按当前 UTC 日期安排工作范围。默认：20 项目、150 **叶子任务**（另有 10 个分组父任务）、90 完成、60 未完成。本周 24＝待做 4 / 进行中 8 / 完成 10 / 待协调 2，今天 8 是本周子集。

统计通过共享纯函数实时计算。父任务不重复计数；界面上的父任务完成数量由后代叶子任务推导，数据库父任务 status 不自动重算，API 禁止直接修改有子项的父任务状态。工作周按所选工作区时区的周一开始（默认 UTC），工作日须属于该日历周。截止日期不会改变工作范围；示例初始化后不会每天自动重新排期。

## 数据库与账号

迁移会在启动时按编号执行，也可显式运行 `npm run db:migrate`。迁移记录保存在 `migrations` 表。空工作区可运行 `PM_WORKSPACE_ID=demo npm run db:seed` 写入合成数据，已有项目时拒绝覆盖。

增加一个成员（同一个 `PM_WORKSPACE_ID` 的成员可查看、编辑全部项目）：

```bash
export PM_USER_EMAIL='member@example.test'
export PM_USER_NAME='Team member'
export PM_WORKSPACE_ID='demo'
read -rs -p 'New password (at least 14 characters): ' PM_USER_PASSWORD
export PM_USER_PASSWORD
npm run user:create
unset PM_USER_PASSWORD
```

已有测试账号需要自行设置新密码时，在自己的私人 Codespace 终端运行 `npm run user:reset-password -- demo@example.test`。按提示两次隐藏输入 14–500 字符的新密码，最后输入 `RESET` 确认提交；旧会话全部失效。此命令不读取旧密码、不接收聊天或命令行密码、不增加公共重置接口。更新部署与手机操作步骤见 [自主改密说明](docs/password-reset.md)。

密码使用随机盐和 scrypt。会话 token 仅保存哈希，HttpOnly / SameSite=Strict Cookie，12 小时到期；生产模式使用 Secure Cookie。写入要求 CSRF token、允许来源、版本号与幂等请求 ID。没有公共注册或匿名写入。SQLite 使用 WAL、外键、预编译语句和事务。幂等结果保留 7 天。

备份请停止写入后复制数据库，或用 SQLite backup API/工具生成一致快照；不要只复制正在写入的主文件而遗漏 WAL。JSON 导出仅包含最近 500 条活动，不能替代完整数据库备份。

## 构建与容器

```bash
npm run build
npm start
```

构建输出 `dist/web` 和 `dist/server`。API 同源提供前端静态资源。若直接打开 `http://localhost:3001`，需先设置 `APP_ORIGIN=http://localhost:3001`。生产设置 `NODE_ENV=production`、明确的 HTTPS `APP_ORIGIN`，在受控反向代理后运行；缺少 HTTPS 配置会拒绝启动。

本地容器（端口只映射到本机，数据用持久卷）：

```bash
docker compose build
docker compose run --rm app node dist/server/apps/api/src/cli.js seed
# 设置上面的 PM_USER_EMAIL / PM_USER_NAME / PM_USER_PASSWORD 后：
docker compose run --rm -e PM_USER_EMAIL -e PM_USER_NAME -e PM_USER_PASSWORD app node dist/server/apps/api/src/cli.js user
docker compose up -d
```

打开 `http://localhost:3001`。容器默认没有账号。`compose.yaml` 明确使用本机 HTTP 模式；不要把此本机演示配置直接暴露到公网。生产 HTTPS、证书、备份、监控、运维账号与容量验证由部署环境配置。

## 移动端测试

375px／390px 触控模拟覆盖主要工作流程；触控目标、菜单焦点和长内容滚动均纳入验收。iOS 真机、Safari 和真实软件键盘尚未验证。仓库不内置已发布的手机运行 URL，访问地址以部署环境为准；运行与私有开发预览说明见 [移动端测试](docs/mobile-testing.md)。

## 检查

```bash
npm run lint
npm run typecheck
npm test
npm run build
npx playwright install chromium   # CI/Linux 可能需要 --with-deps
npm run test:e2e
npm run test:runtime  # 构建产物、真实浏览器与进程重启验证
```

E2E 使用独立的 `data/e2e.sqlite`、运行时随机测试凭证和真实 Web/API。每次执行只重建测试数据库，不改本地工作数据库。默认支持系统 `/usr/bin/chromium`，可通过 `PLAYWRIGHT_CHROMIUM_EXECUTABLE` 指定其他 Chromium。运行时需要空闲 3001、4173 端口。报告在 `playwright-report/`，截图在 `artifacts/`。2026-10-12—2027-01-11 三个月体验改进计划见 [improvement-plan.md](docs/improvement-plan.md)，首批恢复改进见 [m1-recovery.md](docs/m1-recovery.md)。具体实际执行结果及视觉阻碍见 `docs/verification.md` 和 `design-qa.md`。

## 架构

- `apps/web/src/views`：项目、任务、活动、会议、录入、设置和管理页面；`components`：行内表单、任务列表、粘贴及错误显示。
- `stores/workspace.ts`：Pinia 单一快照与写入状态；20 秒后台刷新。
- `services/contracts.ts`：明确的 `WorkspaceApi` 契约；`api.ts` HTTP 实现；`local.ts` 浏览器演示实现。
- `packages/domain`：共享 Zod 运行时校验、类型、统计、合成数据及确定性规则解析。
- `apps/api/src`：Fastify 路由、认证、数据库仓储；SQL 迁移见 `apps/api/migrations`。
- `tests`：领域单元测试、API 集成测试、Chromium E2E；GitHub Actions 提供同样检查，具体提交结果见 draft PR Checks。

## 交付边界

这是已实现并经过本地测试的完整前后端项目，**不等于已部署或已完成生产验收**。尚未实现 SSO/MFA、账号自助恢复、WebSocket 实时推送、多副本分布式会话/限流、自定义字段/流程配置、跨时区偏好和规模压测。Qwen 适配已实现但未完成真实账户连通与付费调用验收。认证账号可由 CLI 配置；多人共享和隔离通过集成测试覆盖，真实多人员/网络部署尚未验收。当前 SQLite 同步查询适合此规模的单实例部署，扩容应测量后替换仓储实现。

没有自动部署、合并或上传真实业务数据。视觉参考文件交付状态与精度边界见 `design-qa.md`。仓库暂无开源许可证；公开可见不等于授予开源授权。

## Qwen 建议适配（默认关闭）

服务端已提供 `qwen3.6-35b-a3b` 建议生成适配、输入输出校验、持久化请求额度和人工确认流程。当前只完成模拟测试，未配置真实密钥、未调用真实模型。浏览器 local demo 不会启用它。供应商/区域端点核对、安全 secret handoff、额度设置及启用步骤见 [Qwen 接入说明](docs/qwen-integration.md)。

升级录入、渐进草稿与管理后台时，请使用 [迁移、私有备份和回滚步骤](docs/upgrade-intake-admin.md)。部署不包含首次管理员授权，也不启用真实模型。
