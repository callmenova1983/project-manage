import { mkdirSync, writeFileSync } from "node:fs";
import { expect } from "@playwright/test";
import { fixture } from "./reliability-fixture.mjs";
// Diagnostic sampling only; the acceptance benchmark has no profiler or instrumentation.
const f = await fixture(200, 25);
try {
  const { context, page } = await f.session(0);
  await page.goto("/projects");
  await expect(page.locator(".project-row")).toHaveCount(200);
  const cdp = await context.newCDPSession(page);
  await cdp.send("Profiler.enable");
  await cdp.send("Profiler.setSamplingInterval", { interval: 100 });
  const reports = [];
  for (let i = 0; i < 3; i++) {
    await page
      .getByLabel("Search projects", { exact: true })
      .fill("Synthetic project 001");
    await expect(page.locator(".project-row")).toHaveCount(1);
    await cdp.send("Profiler.start");
    await page.evaluate(async () => {
      const input = document.querySelector(
        'input[aria-label="Search projects"]',
      );
      input.value = "";
      input.dispatchEvent(new Event("input", { bubbles: true }));
      while (document.querySelectorAll(".project-row").length !== 200)
        await new Promise(requestAnimationFrame);
      await new Promise((resolve) =>
        requestAnimationFrame(() => requestAnimationFrame(resolve)),
      );
    });
    const { profile } = await cdp.send("Profiler.stop");
    const nodes = new Map(profile.nodes.map((n) => [n.id, n])),
      parents = new Map(),
      own = new Map(),
      inclusive = new Map();
    for (const node of profile.nodes)
      for (const child of node.children ?? []) parents.set(child, node.id);
    for (let j = 0; j < profile.samples.length; j++) {
      let id = profile.samples[j];
      const duration = profile.timeDeltas[j] / 1000;
      own.set(id, (own.get(id) ?? 0) + duration);
      while (id !== undefined) {
        inclusive.set(id, (inclusive.get(id) ?? 0) + duration);
        id = parents.get(id);
      }
    }
    const summarize = (map) =>
      [...map]
        .sort((a, b) => b[1] - a[1])
        .slice(0, 20)
        .map(([id, ms]) => ({
          ms: +ms.toFixed(1),
          ...nodes.get(id).callFrame,
        }));
    reports.push({ self: summarize(own), inclusive: summarize(inclusive) });
  }
  mkdirSync("artifacts", { recursive: true });
  const result = {
    environment: f.environment,
    method:
      "Three sampled CPU profiles of 1→200 row resets. Profiler overhead is excluded from acceptance timings. Function locations refer to this compiled bundle; inclusive times overlap.",
    reports,
  };
  writeFileSync("artifacts/filter-cpu.json", JSON.stringify(result, null, 2));
  console.log(JSON.stringify(result));
} finally {
  await f.close();
}
