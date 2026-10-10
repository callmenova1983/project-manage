# 移动端测试与运行入口

## 已实现与本地验证

移动端是验收范围，不需要安装原生 App。375px / 390px Chromium 移动模拟使用触控事件，连接真实 Fastify + SQLite 测试后端。覆盖项目事实与命名任务、Today / This week 切换、组合筛选、详情与返回、长原文保存/取消/刷新、任务和子任务创建/状态、会议歧义/原文/覆盖确认/取消。

主要按钮和行操作至少 44×44 CSS px；菜单具备 dialog 语义、背景 inert、焦点约束、Escape 关闭和焦点返回；小屏原文/任务区域可随页面滚动；保存消息不会拦截触控。另在 440px 视口高度下验证输入后的保存按钮可滚动到可见区域。

**未完成 iOS 真机、Safari、原生选择器和实际软件键盘验收。** 较矮视口检查不等于模拟了 iOS 虚拟键盘；Chromium 的移动模拟不等于真机通过。

## 当前运行状态与入口边界

开发环境中的服务可启动并通过真实浏览器检查，但该环境没有提供手机可访问的端口转发工具。本机 `localhost` 地址不能作为手机入口。没有创建公网隧道，没有发布共享后端，也没有部署 Sites。GitHub PR 链接用于代码和截图审阅，不能运行应用。

Sites 私有站可用于浏览器本地持久化演示，但这属于单独部署；现有 Node + SQLite API 不可直接当作 Workers/D1 后端使用。是否建立该私有演示需单独确定，并保持浏览器演示标识。

## 最小开发测试方式

在具备 Node 24 的电脑或该分支的 GitHub Codespace 中运行：

```bash
npm ci
npm run setup:local
npm run dev:all
```

真实后端登录使用运行时生成、被 Git 忽略的 `data/local-login.txt`，不能将该文件提交或公开。若使用 Codespaces 的私有转发地址，须将 `APP_ORIGIN` 设为其实际 HTTPS 来源，并将该主机名显式加入 Vite 的 `allowedHosts` 后重启；不要关闭主机校验。

仅测试浏览器 UI 和本机持久化时，可运行：

```bash
VITE_DEMO_MODE=1 npm run dev
```

浏览器演示模式不会调用共享后端；数据只保存在当前浏览器。界面持续显示该边界。

如用户已有可用 Codespace，可将 4173 端口保持 **Private**，从 Ports 面板复制 GitHub 实际分配的地址，在登录同一 GitHub 账号的手机浏览器打开。当前未创建 Codespace，也没有可报告的已验证手机 URL；配额、组织策略和真机结果需由实际环境确认。官方操作说明：[Forwarding ports in your codespace](https://docs.github.com/en/codespaces/developing-in-a-codespace/forwarding-ports-in-your-codespace)。
