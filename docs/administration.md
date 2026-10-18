# Administration

`/admin` manages workspace users, stages/business categories, model preferences, call metadata and management activity. `/demo/admin` exercises the same UI against isolated local simulation: it never calls management APIs, creates a server session or provisions real credentials.

## First administrator and existing accounts

Migration `005_administration.sql` adds role, account status, activation state and optimistic version columns, plus catalog, settings, activation, management audit and safe model-log tables. Existing accounts remain **active members**. All workspace members retain shared project/task editing. The migration never chooses or upgrades an administrator automatically.

An authorized server operator must explicitly select an existing active account and workspace in their private terminal:

```bash
PM_USER_EMAIL='verified-user@example.test' PM_WORKSPACE_ID='verified-workspace-id' npm run admin:grant
```

Replace both synthetic placeholders with verified values. The command requires both, rejects workspace mismatch and pending accounts, records the management action and revokes the account's existing sessions. Sign in again to see Administration. No password/key is requested by this command, and this implementation worker has not run it on a real account.

## Users and activation

Administrators can create users, edit names/email/access, disable or re-enable accounts and generate activation links for pending users. Ordinary members cannot read or write administration endpoints; users in other workspaces are not addressable. Versions protect stale editing. The last active administrator cannot be disabled or demoted. Disabling, changing access or changing email revokes sessions. Login also rechecks account status after password verification to prevent an intervening disable from issuing a session.

New users have an unusable random password hash and remain pending until they set their own password. Activation links expire after 24 hours, are replaced when a new link is generated, and are consumed once in a transaction. Only the token hash is stored; raw activation tokens are not written into logs or idempotency responses. The link is shown once to the administrator for private handoff. The URL fragment is removed from browser history before the page initializes. Activation issues no login session. **No email is sent or claimed to be sent.** Disabling and then re-enabling a pending user cannot bypass activation.

The demo offers **Simulate activation**. It creates no usable credential or real activation URL. Demo configuration and audit data persist in the browser.

## Stages, business categories and imports

Entries have stable identifiers, bilingual labels, order, a restricted color palette and an archived state. The five original stage IDs remain. The reserved `unclassified` pending value is handled separately and cannot be redefined in the catalog. Add and edit entries, then Save classifications. Archive existing entries instead of deleting them; existing project/history references are retained. New assignments require active entries, while unchanged archived references may be retained during ordinary project editing. Business categories are separate from responsibility and are selectable in project editors and list filters.

New exports use schema version **3**, including the registry and task planning fields. Legacy versions 1 and 2 remain accepted; versions 2 and 3 require the registry. Replacing the workspace with a legacy file clears schedule dates, milestones and dependencies, with an import-preview warning. Import preview validates references and detects registry changes; importing changes to the registry requires administrator access. Existing catalog IDs cannot be removed by an import. A saved catalog increments its own version to reject stale writes. Database migrations do not reset projects, tasks or synthetic seed data.

## Model settings and logs

Administrators can now enter a Model Studio API key in **Model settings → Qwen API key**, with the region, optional approved API endpoint, total attempt allowance and expiry. Saving makes no external request and explicitly leaves calls disabled; enable calls separately through the existing settings. Previously used attempts count against the same workspace allowance even after key replacement. Server-provisioned environment credentials continue to take precedence and cannot be overwritten through this form. Browser demos cannot save real keys.

**Model settings → AI 调用额度** shows used attempts, the total limit, remaining attempts and expiry. Workspace credential administrators can update only the total limit and expiry without re-entering the key. `PUT /api/admin/model/allowance` preserves the key, budget ID, used attempts and enablement, checks the settings version and rejects a total below the used count. Operator-managed limits remain read-only. New credentials require an explicitly entered total; the former form default of 20 was a test allowance, not a provider limit. Updating the allowance makes no model call and does not automatically enable calls.

Migration `009_model_credentials.sql` stores workspace credentials encrypted with AES-256-GCM. The separate encryption key is created on first save beside the configured database as `<database-path>.credentials-key`, with permissions 0600. Back up that key privately together with the database; restoring the database alone cannot recover saved model credentials. The API never returns the submitted secret or writes it to model settings, audit entries or cached mutation responses. The input is cleared after submission; it is not persisted in browser storage. Configuration does not verify actual Qwen connectivity.

The provider adapter is Qwen, with `qwen3.8-max` as the default. Administrators can select a Qwen model or enter its Model Studio model ID. Administrators can save region, credential reference, timeout, output-token limit and enablement. Saving makes **no model call**. The existing `server-default` reference resolves to the server-provisioned credential or the encrypted credential of the current workspace. Keys are accepted only by the dedicated administrator credential endpoint. Normal model-settings requests reject plaintext key fields and arbitrary environment-variable names. With operator-provisioned credentials, workspace settings still cannot increase server limits or change the approved region, global attempt budget or expiry. Selecting a model preserves the credential and remaining allowance; availability still depends on the provider account and region.

Calls still originate from the meeting review flow, require explicit external-processing confirmation and produce a draft for review rather than applying changes automatically. This page does not claim connectivity has been verified. No real key was configured and no real model call was performed by this worker.

The latest 100 request logs expose time, actor, provider/model, real/simulated/rules mode, status, total elapsed time, attempt count, error code and provider-reported input/output usage when present. Usage represents the successfully parsed response; retries with missing usage are not estimated. Costs remain unknown. Raw source notes, provider output, request headers and keys are excluded. Prior AI request cache records are not backfilled as usage logs because they do not contain trustworthy measurements. The request/attempt budget continues to persist separately. Demo sample logs are explicitly simulated and never mixed with real provider records.

The top navigation shows **Token 用量** for the current workspace. Opening it shows recorded input/output totals and the latest completed call. `GET /api/ai/usage` is authenticated and returns only aggregate counters and latest-call usage/model/time; full logs remain administrator-only. Totals include all retained real model logs, not just the latest 100. Simulated and rules records are excluded. Missing/partial usage and pending requests are counted separately; totals are not a provider billing statement and may understate retries or responses without usage. The display refreshes after a model operation, on opening, or every 20 seconds while the page is visible; reading counters makes no model call. Browser-only demos show zero actual usage.

Management activity is a separate projection containing actor, action, target and time; no credentials or activation links. It displays the latest 100 records. These features do not add SSO, MFA, outbound email, arbitrary model provisioning, real-time push synchronization or production operational approval.


## 企业微信配置

团队页面顶部的企业微信状态标签可点击，在当前页面打开配置图层。管理员可查看企业 ID 并更新通讯录 Secret；已有 Secret 不会回显，留空表示沿用当前企业的 Secret。更换企业 ID 时需要填写对应的新 Secret。

保存后仅更新本工作区的连接配置，不自动同步人员；点击“同步企业微信”才会读取成员和部门。工作区保存的配置优先于服务端环境配置。凭据加密保存在数据库中，沿用数据库旁的 `.credentials-key` 文件；备份数据库时保留该密钥文件。

## 消息中心与企业微信通知

顶栏铃铛打开个人消息中心，待处理、项目动态和已处理分开查看。蓝点表示未读；读取消息不完成任务。稍后提醒只改变个人提醒计划，支持再次到点提示，不修改团队任务日期。工作区账号的关注、阅读和通知偏好保存到服务端；演示模式仅保存在当前浏览器。

原始 AI 录入草稿的待归属与待确认仍在录入器处理，不属于已保存的跨设备通知，也不推送企业微信。消息中心的“本次录入待确认”只表示当前页面内已保存任务的 AI 补全候选；确认正式写入后才通知实际接收人。

管理员在 `/admin` 的“企业微信通知”页配置独立通知应用的 CorpID、AgentID、应用 Secret 和手机可访问的 HTTPS 业务地址。不要把通讯录 Secret 当作通知应用 Secret。Secret 不回显，留空仅在同一企业及应用下沿用，凭据加密保存并沿用数据库旁的 `.credentials-key`；完整备份需要同时私下保存数据库和密钥文件。保存配置不验证实网连通，也不发送测试消息。

启用前用同一企业配置重新同步通讯录，在团队通讯录关联本地登录账号，再到通知页核对并确认接收人。绑定按企业范围、同步可见性及本地账号校验；同步未返回的成员先暂停投递核验，不自动当作离职。个人通知默认仅站内，选择关键提醒或摘要后才会排入企微投递。工作区启用通知不会逐条重发历史记录。

服务端按工作区时区调度，支持安静时段、摘要合并、限频和有上限的已知失败重试。管理员可查看最近投递记录；未绑定显示待核验，接口明确未接受显示失败。发送结果不明时停止自动重试，必须核查并明确确认可能重复后才能重新发送。接口接受、用户阅读和业务处理是三个独立状态，真实企微接收仍需部署环境验收。

通知链接 `/messages/:id` 登录后解析当前业务归属，再打开具体事项；项目合并后旧通知仍可跳转，任务作废后显示当前状态与原因。JSON 工作区导出不包含个人阅读、通知凭据或待投递队列，不能用它替代完整数据库备份；替换导入会取消旧队列，避免历史消息重放。

## 项目文件

在项目详情的“资料 → 项目文件”上传或拖拽附件，点击文件名在同页预览，或下载原文件。已有进展附件也会列出。支持 DOCX、XLS/XLSX、PDF、PPTX、常见图片及 UTF-8 文本预览；旧 DOC、旧 PPT、CAD、压缩包等格式保留原件供下载。单文件最多 50 MB，工作区附件合计最多 256 MB。

附件复用数据库内的 `progress_materials` 存储，按工作区和项目校验访问权限，原文件需要登录才能下载；数据库备份和项目导出包含这些文件及上传信息。上传和预览不调用大模型。浏览器演示不上传附件，需要使用服务端工作区。

Office 预览组件按需加载。PDF 运行时代码在 `predev` / `prebuild` 从已安装的 `@vue-office/pdf` 生成到本地静态目录；中文字体映射和标准字体位于 `apps/web/public/office-assets`，部署时随构建产物一起发布。
