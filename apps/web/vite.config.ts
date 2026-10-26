import { defineConfig } from "vite";
import vue from "@vitejs/plugin-vue";
import { fileURLToPath } from "node:url";
export default defineConfig({
  root: fileURLToPath(new URL(".", import.meta.url)),
  plugins: [vue()],
  server: {
    host: "0.0.0.0",
    port: 4173,
    allowedHosts: ["terminal.local"],
    proxy: { "/api": "http://127.0.0.1:3001" },
  },
  build: { outDir: "../../dist/web", emptyOutDir: true },
});
