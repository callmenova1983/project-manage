import { defineConfig } from "vitest/config";
export default defineConfig({
  test: {
    include: ["tests/unit/**/*.test.ts", "tests/integration/**/*.test.ts"],
    testTimeout: 60000,
    hookTimeout: 60000,
    setupFiles: ["./tests/pg-setup.ts"],
    // Bound memory and password-hashing concurrency on local and CI machines.
    maxWorkers: 2,
  },
});
