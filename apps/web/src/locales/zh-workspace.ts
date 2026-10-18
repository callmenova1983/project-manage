export const workspaceZh: Record<string, string> = {
  "Release to move {name} to {stage}": "松开鼠标，将{name}移至{stage}",
  "Release to change stage": "松开即调整阶段",
  "Moved {name} to {stage}": "已将{name}移至{stage}",
  "Drag the grip to a stage card to change stage, between rows to reorder, or onto a project to merge. Arrow keys also move a focused grip.":
    "拖动 ⋮⋮ 到阶段卡片调整阶段、到行间排序、到项目上合并；方向键也可移动。",

  "AI organize and preview": "AI 整理并预览",
  "Copy assignee to other tasks": "复制负责人到其他任务",
  "Copy due date to other tasks": "复制截止日期到其他任务",
  "Value to copy": "复制的值",
  "Current value": "当前值",
  "Selected tasks already have this value.":
    "所选任务已有相同的值，无需重复复制。",
  "Search target tasks": "搜索目标任务",
  "No matching tasks": "没有匹配的任务",
  "Select one or more tasks. The next visible row is selected by default; only this field will be copied.":
    "可勾选一行或多行，默认选中下一行；只复制当前字段。",
  "Confirm replacing the selected tasks' existing values.":
    "确认覆盖所选任务已有的值。",
  "Copy to {count} tasks": "复制到 {count} 个任务",
  "Copied to {count} tasks": "已复制到 {count} 个任务",
  "Tasks changed. Close the copy dialog, refresh and try again.":
    "任务已有新修改，请关闭复制窗口，刷新后重试。",
  "Fill in the source field before copying.":
    "请先填写要复制的负责人或截止日期。",
  "Choose other tasks without duplicates.": "请选择其他任务，不能重复选择。",
  "Copied task assignee": "复制了任务负责人",
  "Copied task due date": "复制了任务截止日期",
  "Task field copy": "任务字段复制",
  "Paste text, pictures or attach Excel / Word / PDF. AI will organize the progress.":
    "直接粘贴文字、截图，或添加 Excel / Word / PDF，AI 整理为进展日志",
  "Attach pictures / Excel / Word": "添加图片 / Excel / Word",
  "AI recognize and organize": "AI 识别整理",
  "Reading and organizing…": "正在读取并整理…",
  "Original text and image transcription": "原始文字与图片识别内容",
  "AI result is editable. Original sources are retained with the log.":
    "AI 整理结果可直接修改；原始图文随日志保留。",
  "Recognition sends this entry’s text and pictures to the configured model.":
    "识别时，本条文字和图片会发送给后台配置的模型。",
  "AI is not enabled. Configure the model in workspace settings.":
    "AI 尚未启用，请在管理后台配置模型；仍可保存手动填写的日志。",
  "Use up to 6 files per progress entry.": "每条日志最多添加 6 个文件。",
  "Each file must be no larger than 8 MB.": "每个文件不能超过 8 MB。",
  "Linked pictures cannot be copied automatically. Paste a screenshot or attach the original file.":
    "剪贴板中的外链图片未复制，请粘贴截图或上传原文件。",
  "Recognize the source or enter a progress summary before saving.":
    "请先识别图文或填写日志摘要，再保存。",
  "Legacy Office text was extracted. To recognize embedded pictures, save as XLSX/DOCX or paste their screenshots.":
    "已提取旧版 Office 文字。内嵌图片请另存为 XLSX/DOCX，或粘贴截图进行识别。",
  "Some embedded pictures use an unsupported format and were not recognized. Readable text and supported pictures were kept; the original attachment is preserved.":
    "部分内嵌图片的格式暂不支持识别，已读取文字和支持的图片，原附件完整保留。",
  "Only the first 6 embedded pictures were recognized. Readable text and the original attachment were preserved.":
    "已读取文字和前 6 张内嵌图片，其余图片未参与识别，原附件完整保留。",
  "No readable content was found. Paste a screenshot of the document.":
    "未找到可读取的文字或图片，请粘贴文档截图。",
  "Use PNG, JPEG, WebP, XLS, XLSX, DOC, DOCX, PDF, TXT, CSV or TSV.":
    "支持 PNG、JPEG、WebP、XLS、XLSX、DOC、DOCX、PDF、TXT、CSV 或 TSV 文件。",
  "Original sources": "原始图文与附件",
  "Source file not found": "找不到原始附件",
  "File processing requires the server workspace. Your file was not sent.":
    "文件处理需要登录工作区；当前演示模式未发送文件。",
  "Remove {name}": "移除 {name}",

  "Search people": "搜索人员",
  "Name, pinyin, initials or employee number": "姓名、拼音、首字母或工号",
  "People on this project": "项目已有人员 · 优先推荐",
  Team: "团队",
  "Company directory": "团队",
  "Existing project participant": "项目参与人员",
  "Project owner": "项目负责人",
  "Project team": "项目组成员",
  "Already assigned in this project": "已有任务负责人",
  "No matching person": "没有匹配的人员",
  "Use “{name}”": "使用“{name}”",
  "Person outside the directory": "团队以外的人员",

  "Use configured initial password": "使用公司默认密码开通账号",
  "The new account can sign in with its generated login name and the initial password supplied by the company.":
    "新账号开通后，可使用登录账号和公司默认密码登录。",
  "The initial password is not configured on the server.":
    "后台尚未配置默认密码",
  "Created user with configured initial password": "使用默认密码开通了账号",
  "Email or password is incorrect": "账号或密码不正确",
  "Login name": "登录账号",
  "Login name or email": "账号或邮箱",
  Suggested: "建议",
  "Linked login account": "已关联登录账户",
  "Suggested only. Create and activate an account before signing in.":
    "建议账号名；需创建并激活登录账户后才能使用",
  "Leave blank to generate from name": "留空按姓名自动生成，如 zhengyj",
  "This login name is already in use": "该登录账号已被使用",
  "Login names must start with a letter and use letters, numbers, dots, underscores or hyphens.":
    "账号须以字母开头，可使用字母、数字、点、下划线或连字符",
  Edit: "编辑",
  "View source records": "查看资料来源",
  Blocked: "待协调",
  Overdue: "逾期",
  Unfinished: "未完成",
  Unscheduled: "未排期",
  "Unfinished tasks across this stage":
    "此阶段所有未完成任务，父任务不重复计数",
  "Tasks planned this week, including completed work":
    "已安排在本周的任务，包含已完成项",
  "Blocked tasks that need coordination": "仍在等待协调或解除阻塞的任务",
  "Unfinished tasks past an explicit due date":
    "已明确截止日期且到期未完成的任务",
  "Unfinished tasks with no planned week or work day":
    "未完成，且尚未安排工作周或工作日的任务",
  "Add progress for {name}": "为 {name} 新增进展日志",
  "Latest progress log": "最新进展日志",
  "New progress entry": "新增进展日志",
  "Correct last entry": "修正上一条",
  "Progress log added": "进展日志已新增",
  "Progress log corrected": "修正已留痕",
  "Progress history": "进展日志",
  "Every report and correction is retained": "每次上报及修正均保留",
  "Progress report": "进展上报",
  Correction: "修正记录",
  "Added progress log": "新增了进展日志",
  "Corrected latest progress log": "修正了上一条进展日志",
  All: "全部",
  Discipline: "职能",
  "Add planned work": "添加安排",
  "Plan work for {name}": "为 {name} 安排工作",
  "Edit latest update for {name}": "为 {name} 新增进展日志",
  "Click to report progress": "点击填写最新进展",
  "Latest update editor": "最新动态编辑",
  "Ctrl / ⌘ + Enter to save": "Ctrl / ⌘ + Enter 保存 · Esc 取消",
  "This project changed while you were editing. Your text is kept; copy it and reopen the latest update.":
    "项目已有新修改，你输入的内容已保留；请复制后重新打开最新动态编辑。",
  Enabled: "正常",
  Disabled: "停用",
  Actions: "操作",
  Availability: "人员状态",
  "Original notes": "会议原始记录",
  "Edit notes": "编辑记录",
  "No notes yet": "暂无记录",
  "Source records": "资料与来源",
  "Meeting text and earlier context": "需要时展开查阅",
  "Project overview": "项目信息",
  "Add client": "添加客户",
  "Filter tasks": "筛选任务",
  "Theme color": "主题色",
  "Ocean blue": "海洋蓝",
  Teal: "青碧色",
  "Forest green": "森林绿",
  "Warm orange": "暖橙色",
  "Edit name and short name": "修改名称与简称",
  "Edit name, short name and channel": "修改名称、简称与渠道",
  "Double-click to edit name, short name and channel":
    "双击修改名称、简称与渠道",
  "Double-click to edit name and short name": "双击修改名称与简称",
  "Rename {name}": "修改 {name} 名称",
  "Merge {name}": "合并 {name}",
  "Merge projects": "合并项目",
  "Select duplicate projects to combine. All work and history will be kept.":
    "选择要合入的项目，任务、资料和历史记录都会保留。",
  "{count} selected": "已选 {count} 个",
  "Search project, client or channel": "搜索项目、客户或渠道",
  "Selected projects": "已选项目",
  "Deselect {name}": "取消选择 {name}",
  "Name after merging": "合并后名称",
  "Change (optional)": "修改（可选）",
  "Select at least one project above to merge.":
    "请在上方选择至少一个要合入的项目。",
  "Merge into {name}": "合并到：{name}",
  "Short name": "简称",
  "Short name (optional)": "简称（可选）",
  "Shown in the project list": "项目列表优先显示简称",
  "Project name saved": "名称已保存",
  "Projects merged": "项目已合并",
  "Retained project": "保留的项目",
  "Projects to merge into it": "选择要合入的项目",
  "Search source projects": "搜索待合并项目",
  "{projects} projects → 1 project · {tasks} tasks retained":
    "{projects} 个项目合为 1 个 · 保留 {tasks} 条任务",
  "All tasks, dates, notes and history are retained. The retained project keeps its stage, client and owner. Source projects leave the list after merging.":
    "任务、日期、工作笔记和历史均保留。阶段、客户及负责人沿用保留项目；其他项目合并后从列表移除。",
  "Confirm merge": "确认合并",
  "Workspace changed. Refresh the merge preview and try again.":
    "工作区已有新修改，请刷新合并预览后重试。",
  "Choose distinct source projects other than the retained project.":
    "请选择保留项目以外的项目，不能重复选择。",
  "A selected project no longer exists in this workspace.":
    "所选项目已不存在，请刷新。",
  "Unassigned work cannot be merged as a project.":
    "未分配工作收件箱不能作为项目合并。",
  "Combined project content exceeds the limit. Reduce the selection or shorten the notes and aliases first.":
    "合并后的内容超出容量，请减少项目数量或先整理笔记、别名。",
  "Project merges cannot be restored as a single record.":
    "项目合并涉及多条记录，不能用单条历史恢复撤销。",
  "Renamed project": "修改了项目名称",
  "Moved task to merged project": "将任务移入合并项目",
  "Merged source project": "合入了原项目",
  "Merged projects": "合并了项目",
  "Company people & departments": "团队",
  "Manage team members and departments. Editing a project or task automatically joins its project team.":
    "统一管理团队成员与部门；成员编辑项目或任务后自动加入项目组。",
  "Company directory saved": "团队资料已保存",
  "Company directory synced": "团队成员已从企业微信同步",
  "Save directory": "保存团队资料",
  "Company name": "公司名称",
  "{count} people": "{count} 人",
  "{count} departments": "{count} 个部门",
  Departments: "部门",
  Department: "部门",
  "Department name": "部门名称",
  "New department name": "新部门名称",
  "Parent department": "上级部门",
  "Company root": "公司直属",
  "Enterprise department ID": "企业微信部门 ID",
  People: "人员",
  "Add person": "新增人员",
  "Employee number": "工号",
  Name: "姓名",
  Position: "岗位",
  "Enterprise user ID": "企业微信 UserID",
  "Not linked": "尚未关联",
  "Login account": "登录账号",
  "All departments": "全部部门",
  "Filter department": "筛选部门",
  "Search name, employee number or position": "搜索姓名、工号或岗位",
  "No people match": "没有匹配的人员",
  "Enterprise directory sync": "企业微信通讯录同步",
  "Sync enterprise directory": "同步企业微信",
  "Syncing…": "同步中…",
  "Enterprise directory is configured. Sync reads the visible people and departments.":
    "已配置企业微信，同步会读取应用可见范围内的人员与部门。",
  "Enterprise directory is not configured. Local people and departments remain available.":
    "企业微信尚未配置；本地人员与部门可正常使用。",
  "Existing people can be matched by enterprise user ID or unique email. Sync keeps local employee numbers and account links.":
    "按企业微信 UserID 或唯一邮箱匹配已有人员，保留本地工号和账号关联。",
  "Administrators maintain the directory and enterprise connection.":
    "团队资料及企业微信连接由管理员维护。",
  "Last sync": "上次同步",
  "Save directory changes before syncing.":
    "请先保存团队资料修改，再执行同步。",
  "Company directory changed. Reload before saving.":
    "团队资料已有新修改，请重新加载后保存。",
  "Employee account must belong to this workspace.":
    "人员只能关联当前工作区的账号。",
  "Enterprise directory sync is not configured for this workspace.":
    "此工作区尚未配置企业微信通讯录同步。",
  "Enterprise directory sync is not available in the browser demo.":
    "浏览器演示不支持企业微信真实同步。",
  "Unable to reach the enterprise directory. No local data was changed.":
    "无法连接企业微信，本地通讯录未改变。",
  "Enterprise WeChat rejected the server IP (60020). Add the server's public outbound IP to the application's trusted IP list, then sync again. No local data was changed.":
    "企业微信拒绝了服务器 IP（60020）。请在企业微信应用的企业可信 IP 中添加服务器公网出口 IP，再重新同步。本地通讯录未改变。",
  "Enterprise directory returned an invalid response.":
    "企业微信返回的数据格式无效。",
  "Enterprise WeChat rejected the CorpID and Secret when obtaining an access token (40001). Check the Secret for this CorpID in the enterprise admin console; enter the Secret, not an access_token. No local data was changed.":
    "企业微信在获取令牌时拒绝了当前 CorpID 和 Secret（40001）。请在企业微信管理后台核对该企业对应的 Secret；这里填写 Secret，不能填写 access_token。本地团队数据未改变。",
  "Enterprise directory returned invalid data. No local data was changed.":
    "企业微信返回的数据无效，本地通讯录未改变。",
  "Editors join automatically": "参与编辑后自动加入",
  "No editors yet. The first saved edit adds its author to this project team.":
    "尚无编辑成员；保存项目或任务后，编辑人自动加入项目组。",
  "Double-click to edit task title": "双击修改任务标题",
  "Click to edit": "点击修改",
  "Quick add task": "快速新增任务",
  "Quick add subtask": "快速新增子任务",
  "Task title · Enter to add": "输入任务标题，Enter 创建",
  "Subtask title · Enter to add": "输入子任务标题，Enter 创建",
  "New tasks start as to do, planned this week. Assignee and date can be set in the row.":
    "默认待办、安排在本周；负责人和日期可在任务行内设置。",
  More: "更多",
  Add: "添加",
  Save: "保存",
  Close: "关闭",
  "WORKSPACE / TEAM": "工作区 / 团队",
  Organization: "组织架构",
  "Manage organization": "管理组织",
  "Search departments": "搜索部门",
  "Expand departments": "展开部门",
  "All people": "全部人员",
  "{count} enabled people": "{count} 位可用成员",
  "{count} linked": "已关联 {count} 人",
  "Enterprise connection configured": "企业微信已配置",
  "Enterprise credentials saved": "企业微信凭据已保存",
  "Enterprise sync failed": "企业微信同步失败",
  "Enterprise connection not configured": "企业微信未配置",
  "Filter availability": "筛选人员状态",
  "Filter enterprise association": "筛选企业微信关联",
  "All associations": "全部关联状态",
  Linked: "已关联",
  "Enterprise association": "企业微信关联",
  "Showing {count} people": "共 {count} 位成员",
  "Editors join project teams automatically": "编辑项目或任务后自动加入项目组",
  "Double-click to edit person": "双击编辑人员",
  "Edit person": "编辑人员",
  "Optional enterprise identity": "可留空，填写企业微信 UserID 后关联",
  "Account & email settings": "账号与邮箱设置",

  "Add department": "新增部门",
  "Check names, employee numbers, departments and account links.":
    "请检查姓名、部门，确认工号和账号关联没有重复。",
  "Manual order": "手动排序",
  "Move {name}": "移动 {name}",
  "Drag to reorder or merge": "拖动排序或合并，方向键也可移动",
  "Release to merge into this project": "松开鼠标，合入此项目",
  "Drag the grip between rows to reorder, or onto a project to merge. Arrow keys also move a focused grip.":
    "拖动 ⋮⋮ 到行间排序、到项目上合并；方向键也可移动。",
  "Project order saved": "项目顺序已保存",
  "Project order updated": "项目顺序已调整",
  "Reordered projects": "调整了项目顺序",
  "Workspace changed. Refresh the project order and try again.":
    "工作区已有新修改，请刷新后重新调整顺序。",
  "Project order must include every current project exactly once.":
    "项目顺序与当前列表不一致，请刷新后重试。",
  "{percent}% of projects": "占项目总数 {percent}%",
};
