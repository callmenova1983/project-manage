# API

Fastify + TypeScript + Node 24 内置 SQLite。根目录运行 `npm run dev:api`。首次使用先 `npm run setup:local`，完整配置、鉴权、运行边界见根目录 README 和 `docs/api.md`。

## AI SDK 启用与回退

`AI_RUNTIME` 控制后端调用方式，默认 `legacy`；可选值仅为 `legacy` 和 `sdk`。它同时覆盖环境凭据与工作区保存的凭据，不改写密钥、模型、额度或业务数据。

在项目根目录使用 Node 24 启动后端：

```sh
AI_RUNTIME=sdk npm run dev:api
```

构建部署使用 `AI_RUNTIME=sdk npm start`；切换前必须重新构建，修改环境变量后必须重启实际 API 进程。4173 的 Vite 页面可访问不代表 API 已切换。启动输出应包含 `AI runtime: sdk`，随后正常业务调用的模型日志应记录 `runtime: sdk`。验证脚本可单独选择运行模式，其日志不证明服务已切换。

回退时用同一个数据库、同一组其他环境配置，以 `AI_RUNTIME=legacy` 重启后端。确认启动输出及后续调用日志为 `legacy`。不要清空数据库、轮换凭据、重置额度或重放已保存的操作；已有草稿及结果按权威状态恢复。

验收进度和已知缺口见 [一期验收](../../docs/assistant-phase-one.md)。启用开关不等同于完成真实日报或实体手机验收。
