import { defineConfig } from "@playwright/test";
import base from "./playwright.config";
export default defineConfig({
  ...base,
  testMatch: "wecom-login.spec.ts",
  outputDir: "test-results/wecom-login",
  use: { ...base.use, baseURL: "http://127.0.0.1:4187" },
  webServer: {
    command: "node --import tsx tests/fixtures/wecom-login-server.mjs",
    url: "http://127.0.0.1:4187/api/health",
    reuseExistingServer: false,
  },
});
