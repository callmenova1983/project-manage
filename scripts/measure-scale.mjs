import { mkdirSync, writeFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { expect } from "@playwright/test";
import { fixture } from "./reliability-fixture.mjs";
import { projectInput } from "../dist/server/packages/domain/types.js";

const f = await fixture(200, 25),
  errors = [];
const samples = { firstScreenMs: [], filterMs: [], syncMs: [], snapshotMs: [] };
const label = process.argv[2] === "baseline" ? "baseline" : "final";
const percentile = (values) => {
  const sorted = [...values].sort((a, b) => a - b);
  return {
    n: values.length,
    p50: +sorted[Math.ceil(values.length * 0.5) - 1].toFixed(1),
    p95: +sorted[Math.ceil(values.length * 0.95) - 1].toFixed(1),
    max: +Math.max(...values).toFixed(1),
    samples: values.map((v) => +v.toFixed(1)),
  };
};
function observe(page) {
  page.on("pageerror", (e) => errors.push(e.message));
  page.on("console", (m) => {
    if (m.type() === "error") errors.push(m.text());
  });
}
try {
  const writer = await f.session(0),
    state = await writer.context.storageState();
  const payload = await writer.context.request.get("/api/workspace");
  const snapshot = await payload.json();
  expect(snapshot.projects).toHaveLength(200);
  expect(snapshot.tasks).toHaveLength(5000);
  const bytes = (await payload.body()).length;
  // New browser context for each navigation: empty HTTP cache, existing authenticated session.
  for (let i = 0; i < 20; i++) {
    const context = await f.browser.newContext({
      baseURL: f.origin,
      storageState: state,
      viewport: { width: 1536, height: 1024 },
    });
    const page = await context.newPage();
    observe(page);
    const start = performance.now();
    await page.goto("/projects");
    await expect(page.locator(".project-row")).toHaveCount(200, {
      timeout: 60000,
    });
    await page.evaluate(
      () =>
        new Promise((resolve) =>
          requestAnimationFrame(() => requestAnimationFrame(resolve)),
        ),
    );
    samples.firstScreenMs.push(performance.now() - start);
    for (const [query, count] of [
      ["Synthetic project 001", 1],
      ["", 200],
    ]) {
      const duration = await page.evaluate(
        async ({ query, count }) => {
          const input = document.querySelector(
            'input[aria-label="Search projects"]',
          );
          const start = performance.now();
          input.value = query;
          input.dispatchEvent(new Event("input", { bubbles: true }));
          while (document.querySelectorAll(".project-row").length !== count)
            await new Promise(requestAnimationFrame);
          await new Promise((resolve) =>
            requestAnimationFrame(() => requestAnimationFrame(resolve)),
          );
          return performance.now() - start;
        },
        { query, count },
      );
      samples.filterMs.push(duration);
    }
    await context.close();
    if ((i + 1) % 5 === 0)
      console.log(
        `Scale ${label}: ${i + 1}/20 cold-context navigations measured`,
      );
  }
  mkdirSync("artifacts", { recursive: true });
  writeFileSync(
    `artifacts/scale-${label}-navigation.json`,
    JSON.stringify({ environment: f.environment, samples }, null, 2),
  );
  // Five separately authenticated, visible contexts; four acknowledged writes; normal 20s polling, no manual refresh.
  const sessions = [writer];
  for (let i = 1; i < 5; i++) sessions.push(await f.session(i));
  for (const s of sessions) {
    observe(s.page);
    await s.page.goto("/projects");
    await expect(s.page.locator(".project-row")).toHaveCount(200);
    expect(await s.page.evaluate(() => document.hidden)).toBe(false);
  }
  for (let round = 0; round < 4; round++) {
    const current = await (
      await writer.context.request.get("/api/projects/scale-1")
    ).json();
    const marker = `Synthetic sync observation ${round}`;
    const response = await writer.context.request.put("/api/projects/scale-1", {
      headers: {
        "x-csrf-token": writer.auth.csrf,
        "idempotency-key": randomUUID(),
      },
      data: {
        ...projectInput.strip().parse(current),
        latestUpdate: marker,
        version: current.version,
      },
    });
    expect(response.status()).toBe(200);
    const acknowledged = performance.now();
    await Promise.all(
      sessions.map(async (s) => {
        await expect(
          s.page.locator('[data-project-record="scale-1"] .latest-update'),
        ).toContainText(marker, { timeout: 35000 });
        samples.syncMs.push(performance.now() - acknowledged);
      }),
    );
    console.log(
      `Scale ${label}: sync write ${round + 1}/4 observed by five sessions`,
    );
  }
  for (let i = 0; i < 20; i++) {
    const start = performance.now();
    const r = await writer.context.request.get("/api/workspace");
    expect(r.status()).toBe(200);
    await r.json();
    samples.snapshotMs.push(performance.now() - start);
  }
  expect(errors).toEqual([]);
  mkdirSync("artifacts", { recursive: true });
  const result = {
    label,
    environment: f.environment,
    dataset: { projects: 200, leafTasks: 5000, snapshotBytes: bytes },
    methodology:
      "20 fresh authenticated browser contexts; navigation through 200 rendered rows and two animation frames; 40 input-to-render filter observations (narrow/reset); 20 sync observations = four writes x five independent visible sessions using normal polling, correlated within each write; no CPU/network throttle",
    targetsMs: { firstScreen: 3000, filter: 200, sync: 25000 },
    metrics: Object.fromEntries(
      Object.entries(samples).map(([k, v]) => [k, percentile(v)]),
    ),
    unexpectedBrowserErrors: errors.length,
  };
  writeFileSync(
    `artifacts/scale-${label}.json`,
    JSON.stringify(result, null, 2),
  );
  console.log(JSON.stringify(result));
} finally {
  await f.close();
}
