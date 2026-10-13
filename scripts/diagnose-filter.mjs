import { mkdirSync, writeFileSync } from "node:fs";
import { expect } from "@playwright/test";
import { fixture } from "./reliability-fixture.mjs";
// Instrumentation is diagnostic only; measure-scale.mjs remains unchanged.
const f = await fixture(200, 25);
const label = process.argv[2] === "before" ? "before" : "after";
try {
  const { page } = await f.session(0);
  await page.addInitScript(() => {
    globalThis.__formatCounts = {
      numbers: 0,
      dates: 0,
      dateParts: 0,
      dateObjects: 0,
    };
    globalThis.Date = new Proxy(Date, {
      construct(target, args) {
        globalThis.__formatCounts.dateObjects++;
        return Reflect.construct(target, args);
      },
    });
    for (const [name, key] of [
      ["NumberFormat", "numbers"],
      ["DateTimeFormat", "dates"],
    ]) {
      Intl[name] = new Proxy(Intl[name], {
        construct(target, args) {
          globalThis.__formatCounts[key]++;
          return Reflect.construct(target, args);
        },
      });
    }
    const original = Intl.DateTimeFormat.prototype.formatToParts;
    Intl.DateTimeFormat.prototype.formatToParts = function (...args) {
      globalThis.__formatCounts.dateParts++;
      return original.apply(this, args);
    };
  });
  await page.goto("/projects");
  await expect(page.locator(".project-row")).toHaveCount(200);
  const observations = [];
  for (let sample = 0; sample < 3; sample++) {
    for (const [query, count] of [
      ["Synthetic project 001", 1],
      ["", 200],
    ]) {
      observations.push(
        await page.evaluate(
          async ({ query, count }) => {
            globalThis.__formatCounts = {
              numbers: 0,
              dates: 0,
              dateParts: 0,
              dateObjects: 0,
            };
            const input = document.querySelector(
              'input[aria-label="Search projects"]',
            );
            input.value = query;
            input.dispatchEvent(new Event("input", { bubbles: true }));
            while (document.querySelectorAll(".project-row").length !== count)
              await new Promise(requestAnimationFrame);
            await new Promise((resolve) =>
              requestAnimationFrame(() => requestAnimationFrame(resolve)),
            );
            return { resultingRows: count, ...globalThis.__formatCounts };
          },
          { query, count },
        ),
      );
    }
  }
  mkdirSync("artifacts", { recursive: true });
  const result = {
    label,
    environment: f.environment,
    method:
      "Separate instrumented diagnostic: count Intl constructors and formatToParts calls during three narrow/reset cycles; not an acceptance timing sample.",
    observations,
  };
  writeFileSync(
    `artifacts/filter-constructors-${label}.json`,
    JSON.stringify(result, null, 2),
  );
  console.log(JSON.stringify(result));
} finally {
  await f.close();
}
