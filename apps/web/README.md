# Web

Vue 3 + Pinia + Vue Router。根目录运行 `npm run dev`；默认通过 Vite 的 `/api` 代理连接 127.0.0.1:3001。主文档见根目录 README。

`services/contracts.ts` 隔离 API；环境变量 `VITE_DEMO_MODE=1` 使用独立本地存储。组件仅接触状态层与领域契约，后端负责授权和最终校验。
