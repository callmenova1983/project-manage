import { expect, type Page } from "@playwright/test";
import { readFileSync } from "node:fs";
/** Test clients respect the unchanged server login limit; never disable authentication. */
export async function scenarioLogin(page: Page, file: string) {
  const credentials = JSON.parse(readFileSync(file, "utf8"));
  let response = await page.request.post("/api/auth/login", {
    data: credentials,
  });
  if (response.status() === 429) {
    const seconds = Number(response.headers()["retry-after"]);
    expect(
      Number.isFinite(seconds) && seconds > 0 && seconds <= 60,
      "Server must provide a bounded Retry-After",
    ).toBe(true);
    console.info(
      `Synthetic scenario login reached HTTP 429; respecting Retry-After ${seconds}s`,
    );
    let remaining = seconds * 1000 + 100;
    while (remaining > 0) {
      const delay = Math.min(10000, remaining);
      await page.waitForTimeout(delay);
      remaining -= delay;
    }
    response = await page.request.post("/api/auth/login", {
      data: credentials,
    });
  }
  expect(
    response.ok(),
    `Synthetic scenario login returned HTTP ${response.status()}`,
  ).toBe(true);
  return response.json();
}
