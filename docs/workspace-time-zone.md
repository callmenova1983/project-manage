# 工作区时区与历史导出

## 使用方式与兼容

在 Workspace → Workspace time zone 中选择 IANA 地区名称，勾选共享日历确认后保存。北京选择 `Asia/Shanghai`。已有和新建工作区默认 `UTC`，升级不会自动猜测位置或改变真实工作区配置。普通成员可以查看，管理员（本地演示中的模拟管理员）可以更改；项目和任务的全员协作权限不变。

设置有独立版本、显式确认和管理审计，保存冲突会保留输入，须明确重新加载当前设置。离开未保存表单有提醒。保存后工作区 revision 增加，其他客户端沿用现有轮询/前台刷新获取设置。

任务 `workWeek`、`workDates` 和截止日属于日历日期，原值不移动；`createdAt`、`reportedAt` 等保存的时间戳也不重写。时区用于当前“今天／本周”、历史范围、每日分布和时间显示。日期字符串不作为瞬间转换，避免在西半球显示成前一天。截止日期仍不决定工作范围，父子任务仍只计叶子任务。

## 同一边界、同一快照

所有历史入口使用 `packages/domain/time-zone.ts` 的自然周边界：当地周一 00:00（含）至下周一 00:00（不含）。免费 ISC 许可的 `@js-temporal/polyfill` 锁定为 `0.5.1`，使用运行环境 IANA 时区数据；不以固定 UTC 偏移模拟地区夏令时。需要更新时区法规时，应更新受支持的 Node/浏览器运行环境并回归边界测试。

- 北京 `2026-10-12` 周开始于 `2026-10-11T16:00:00.000Z`。
- 纽约 2026 春季切换周 167 小时、秋季切换周 169 小时。
- Lord Howe 的半小时切换周分别是 167.5 / 168.5 小时。

首页完整周统计、Activity 范围查询、分页和导出共享此函数。响应明确包含 `timeZone`、UTC `bounds`、每日日期及 `checkpoint`（筛选范围、插入水位、读取时刻）。分页和导出沿用首次读取的水位，因此之后补写的旧日期记录不会混入。刷新开始新的快照。时区或筛选变更会使旧游标/导出快照失效；不会混用两个范围。

Activity 的 **Export filtered history** 导出全部匹配记录及上述元数据，不受当前显示页大小限制，也不包括单独定位但不符合筛选的历史锚点。单次上限 10,000 条，超过会明确要求缩小筛选范围，不静默截断。Workspace 的项目/任务 JSON 导出仍只含最近 500 条历史预览，这是另一种用途的导出；现在同时包含时区元数据。导入项目/任务文件始终保留目标工作区时区，若要改时区须使用上述明确设置流程。

接口：`PUT /api/admin/workspace-settings`（`{version,timeZone,confirmed:true}`）、`POST /api/activity/query`、`POST /api/activity/export`。本地适配器实现相同设置和查询契约，不向服务器或模型发送资料。

## 升级与回退

迁移 `007_workspace_time_zone.sql` 只为 workspaces 增加 `time_zone`（默认 UTC）与 `settings_version`（默认 1），不重写项目、任务、人员、历史或凭据。迁移 006 的历史索引继续使用。

升级前停止写入或进入维护窗口，依照 [备份与独立恢复流程](runtime-entry-recovery.md) 用 `npm run db:backup -- ...` 生成包含 WAL 已提交内容的私有备份并校验。随后部署代码并运行迁移；先在独立测试实例验证。若需完整回退，停止新版进程，保留故障现场和升级后新增数据，在私有新路径恢复升级前备份，使用相应旧版代码验证后再切换。不要在运行中的真实数据库直接删列，也不要将旧备份覆盖正在写入的数据库。回退到备份时刻会舍弃其后的写入，须另行对账。

自动测试使用合成 v6 数据库、完整记录逐项对照、v7 重启持久化及原始 v6 备份恢复；不是对真实客户数据做过升级验收。

## 验证与边界

见 [执行记录](verification.md) 与 Draft PR #1 的精确提交 CI。最终合成截图：

- [桌面设置](screenshots/time-zone-settings-desktop.png) / [390px 设置](screenshots/time-zone-settings-mobile.png)
- [桌面周摘要](screenshots/time-zone-weekly-desktop.png) / [390px 周摘要](screenshots/time-zone-weekly-mobile.png)
- [桌面历史导出](screenshots/time-zone-history-desktop.png) / [390px 历史导出](screenshots/time-zone-history-mobile.png)

本次不部署、不修改真实工作区时区、不调用付费模型、不建立真实后端账号。真实设备、生产 HTTPS/CSP、线上迁移、规模/长期运行、实时推送、真实 AI 和参考原图像素验收仍不在已验证范围。
