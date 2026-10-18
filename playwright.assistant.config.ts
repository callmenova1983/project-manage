import { defineConfig } from "@playwright/test";
import base from "./playwright.config";

export default defineConfig({
  ...base,
  testMatch: ["capture-overlay.spec.ts", "capture-attachments.spec.ts"],
  outputDir: "test-results/assistant-upgrade",
  use: { ...base.use, baseURL: "http://127.0.0.1:4185" },
  webServer: {
    command: "./node_modules/.bin/vite --config apps/web/vite.assistant-test.config.ts",
    url: "http://127.0.0.1:4185",
    reuseExistingServer: false,
  },
});
