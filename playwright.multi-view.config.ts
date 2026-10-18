import { defineConfig } from "@playwright/test";
import { existsSync } from "node:fs";
import { resolve } from "node:path";

const directory = process.env.PM_MULTI_VIEW_TEST_DIR;
if (!directory)
  throw new Error(
    "Set PM_MULTI_VIEW_TEST_DIR to a fresh isolated temporary directory.",
  );
const port = Number(process.env.PM_MULTI_VIEW_E2E_PORT ?? 4189);
if (!Number.isInteger(port) || port < 1024 || port > 65535)
  throw new Error("Invalid isolated E2E port.");
export default defineConfig({
  testDir: "tests/e2e/multi-view",
  fullyParallel: false,
  workers: 1,
  retries: 0,
  timeout: 60000,
  expect: { timeout: 8000 },
  outputDir: resolve(directory, "test-results"),
  reporter: [
    ["list"],
    ["json", { outputFile: resolve(directory, "report.json") }],
  ],
  use: {
    baseURL: `http://127.0.0.1:${port}`,
    headless: true,
    viewport: { width: 1536, height: 1000 },
    colorScheme: "light",
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    launchOptions: {
      executablePath:
        process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE ??
        (existsSync(
          "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
        )
          ? "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
          : undefined),
    },
  },
  webServer: {
    command: "node --import tsx scripts/multi-view-e2e-server.ts",
    url: `http://127.0.0.1:${port}/api/health`,
    reuseExistingServer: false,
    timeout: 30000,
  },
});
