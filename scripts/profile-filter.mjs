import { mkdirSync, writeFileSync } from "node:fs";
import { expect } from "@playwright/test";
import { fixture } from "./reliability-fixture.mjs";
const f = await fixture(200, 25);
try {
  const { context, page } = await f.session(0),
    observations = [];
  await page.goto("/projects");
  await expect(page.locator(".project-row")).toHaveCount(200);
  const cdp = await context.newCDPSession(page);
  await cdp.send("Performance.enable");
  const metrics = async () =>
    Object.fromEntries(
      (await cdp.send("Performance.getMetrics")).metrics.map((m) => [
        m.name,
        m.value,
      ]),
    );
  for (let i = 0; i < 5; i++) {
    await page
      .getByLabel("Search projects", { exact: true })
      .fill("Synthetic project 001");
    await expect(page.locator(".project-row")).toHaveCount(1);
    const before = await metrics();
    const elapsedMs = await page.evaluate(async () => {
      const input = document.querySelector(
          'input[aria-label="Search projects"]',
        ),
        start = performance.now();
      input.value = "";
      input.dispatchEvent(new Event("input", { bubbles: true }));
      while (document.querySelectorAll(".project-row").length !== 200)
        await new Promise(requestAnimationFrame);
      await new Promise((resolve) =>
        requestAnimationFrame(() => requestAnimationFrame(resolve)),
      );
      return performance.now() - start;
    });
    const after = await metrics();
    observations.push({
      elapsedMs,
      ...Object.fromEntries(
        [
          "ScriptDuration",
          "LayoutDuration",
          "RecalcStyleDuration",
          "TaskDuration",
        ].map((key) => [
          key + "Ms",
          +(1000 * (after[key] - before[key])).toFixed(1),
        ]),
      ),
    });
  }
  mkdirSync("artifacts", { recursive: true });
  const result = {
    environment: f.environment,
    method:
      "Five 1→200 row resets; Chromium CDP Performance metric deltas around input and two animation frames. TaskDuration includes script/layout/style and must not be summed with them. Diagnostic samples are separate from the acceptance benchmark.",
    observations,
  };
  writeFileSync(
    "artifacts/filter-profile.json",
    JSON.stringify(result, null, 2),
  );
  console.log(JSON.stringify(result));
} finally {
  await f.close();
}
