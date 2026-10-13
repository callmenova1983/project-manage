import { test, expect, type Page } from "@playwright/test";
import { mkdirSync, readFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import AxeBuilder from "@axe-core/playwright";
import { createSeed } from "../../packages/domain/seed";
import { leafTasks, taskInput, weekKey } from "../../packages/domain/types";
const errors: string[] = [];
const expectedFailures = new Set<string>();
test.beforeEach(({ page }) => {
  errors.length = 0;
  expectedFailures.clear();
  page.on("pageerror", (e) => errors.push(e.message));
  page.on("console", (m) => {
    const status = /^Failed to load resource:.*status of (\d+)/.exec(
      m.text(),
    )?.[1];
    const path = new URL(m.location().url || "/", "http://localhost").pathname;
    if (m.type() === "error" && !expectedFailures.has(`${path}:${status}`))
      errors.push(m.text());
  });
  mkdirSync("artifacts/interaction-feedback", { recursive: true });
});
test.afterEach(() => expect(errors).toEqual([]));
async function noOverflow(page: Page) {
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
}
for (const width of [1536, 390])
  test(`completion links counts, real history and protected undo at ${width}px`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: width === 390 ? 844 : 1024 });
    const calls: string[] = [];
    page.on("request", (r) => {
      if (r.url().includes("/api/")) calls.push(r.url());
    });
    const seed = createSeed();
    const task = leafTasks(seed.tasks).find(
      (task) => task.status === "blocked" && task.workWeek === weekKey(),
    )!;
    const project = seed.projects.find(
      (project) => project.id === task.projectId,
    )!;
    await page.goto("/demo/projects");
    await page
      .getByRole("button", { name: `Expand ${project.name}`, exact: true })
      .click();
    const row = page.locator(".task-row").filter({
      has: page.getByRole("checkbox", {
        name: `Complete ${task.title}`,
        exact: true,
      }),
    });
    await row.getByRole("checkbox").evaluate((button) => {
      (button as HTMLElement).click();
      (button as HTMLElement).click();
    });
    await expect(page.locator(".workspace-totals")).toContainText(
      "91 completed",
    );
    await expect(row.getByRole("checkbox")).toBeChecked();
    await expect(row.getByLabel(`Status for ${task.title}`)).toHaveValue(
      "done",
    );
    await expect(
      page.getByRole("button", { name: "Undo status change", exact: true }),
    ).toBeEnabled();
    await page
      .getByRole("button", { name: "Changes & next work", exact: true })
      .click();
    await expect(page.locator(".completed-metric strong")).toHaveText("1");
    await expect(
      page.locator(".weekly-changes .change-metrics strong").first(),
    ).toHaveText("1");
    await page.evaluate(() => window.scrollTo(0, 0));
    await page.screenshot({
      path: `artifacts/interaction-feedback/completed-${width}.png`,
    });
    await page
      .getByRole("button", { name: "Undo status change", exact: true })
      .evaluate((button) => {
        (button as HTMLElement).click();
        (button as HTMLElement).click();
      });
    await expect(page.locator(".task-feedback")).toContainText("Change undone");
    await expect(page.locator(".workspace-totals")).toContainText(
      "90 completed",
    );
    await expect(row.getByLabel(`Status for ${task.title}`)).toHaveValue(
      "blocked",
    );
    await expect(
      page.locator(".weekly-changes .change-metrics strong").first(),
    ).toHaveText("2");
    await expect(page.locator(".completed-metric strong")).toHaveText("1");
    await expect(page.locator(".change-timeline")).toContainText(
      "Previous version restored",
    );
    await page
      .getByRole("button", { name: "Dismiss task feedback", exact: true })
      .click();
    await expect(page.locator("#main-content")).toBeFocused();
    await page.locator(".language-select").selectOption("zh-CN");
    await page.locator(".theme-switch").click();
    // Capture the settled theme, not an intermediate colour-transition frame.
    await page.evaluate(async () => {
      await new Promise(requestAnimationFrame);
      await Promise.all(
        document
          .getAnimations()
          .filter(
            (animation) =>
              animation.effect?.getTiming().iterations !== Infinity,
          )
          .map((animation) => animation.finished.catch(() => {})),
      );
    });
    expect(
      (await new AxeBuilder({ page }).include(".next-work").analyze())
        .violations,
    ).toEqual([]);
    await page.screenshot({
      path: `artifacts/interaction-feedback/linked-zh-light-${width}.png`,
    });
    await noOverflow(page);
    expect(calls).toEqual([]);
  });

test("mobile collapse cancels safely, restores focus and retains project context on Back", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto("/demo/projects");
  await expect(page.locator(".project-record")).toHaveCount(20);
  await page
    .getByRole("button", { name: "Expand Atlas Customer Portal", exact: true })
    .click();
  const notes = page.getByLabel("Original notes for Atlas Customer Portal");
  const old = await notes.inputValue();
  await notes.fill("Synthetic unsaved interaction check");
  page.once("dialog", (d) => d.dismiss());
  await page
    .getByRole("button", {
      name: "Collapse Atlas Customer Portal",
      exact: true,
    })
    .click();
  await expect(notes).toHaveValue("Synthetic unsaved interaction check");
  page.once("dialog", (d) => d.accept());
  await page
    .getByRole("button", {
      name: "Collapse Atlas Customer Portal",
      exact: true,
    })
    .click();
  const expand = page.getByRole("button", {
    name: "Expand Atlas Customer Portal",
    exact: true,
  });
  await expect(expand).toBeFocused();
  await expect(expand).toHaveAttribute("aria-expanded", "false");
  await expand.press("Enter");
  await expect(notes).toHaveValue(old);
  expect(
    await page
      .locator(".expanded-content")
      .evaluate((el) => getComputedStyle(el).animationName),
  ).toBe("none");
  await page.getByLabel("Search projects", { exact: true }).fill("Atlas");
  await page
    .getByRole("link", { name: "Open Atlas Customer Portal", exact: true })
    .click();
  await page.goBack();
  await expect(page.getByLabel("Search projects", { exact: true })).toHaveValue(
    "Atlas",
  );
  await expect(expand).toHaveAttribute("aria-expanded", "true");
  await expect(expand).toBeFocused();
  await page.locator(".project-record.expanded").screenshot({
    path: "artifacts/interaction-feedback/project-expanded-mobile.png",
  });
  await page.getByLabel("Search projects", { exact: true }).fill("");
  await expect(page.locator(".project-record")).toHaveCount(20);
  await page
    .getByRole("button", {
      name: "Collapse Atlas Customer Portal",
      exact: true,
    })
    .click();
  const last = page.locator(".project-record").last();
  await last.locator(".expand-button").click();
  await expect(last.locator(".expanded-content")).toBeVisible();
  await last.locator(".project-return-actions button").click();
  await expect(last.locator(".expand-button")).toBeFocused();
  await noOverflow(page);
});

test("completing the final planned card reaches an empty state and undo restores it", async ({
  page,
}) => {
  const seed = createSeed();
  const only = leafTasks(seed.tasks).find(
    (task) => task.status !== "done" && task.workWeek === weekKey(),
  )!;
  seed.tasks = seed.tasks.map((task) => ({
    ...task,
    status: task.id === only.id ? "in_progress" : "done",
  }));
  seed.activities = [];
  await page.addInitScript(
    (snapshot) =>
      localStorage.setItem("project-manage-demo-v1", JSON.stringify(snapshot)),
    seed,
  );
  await page.goto("/demo/projects");
  await page
    .getByRole("button", { name: "Changes & next work", exact: true })
    .click();
  const rail = page.getByRole("list", {
    name: "Planned task cards",
    exact: true,
  });
  await expect(rail.locator("li")).toHaveCount(1);
  const toggle = rail.getByRole("checkbox", {
    name: `Complete ${only.title}`,
    exact: true,
  });
  await toggle.focus();
  await toggle.press("Space");
  await expect(page.locator(".next-work")).toContainText(
    "Nothing pending in this scope",
  );
  await expect(
    page.getByRole("button", { name: "Undo status change", exact: true }),
  ).toBeFocused();
  await page
    .getByRole("button", { name: "Undo status change", exact: true })
    .press("Enter");
  await expect(rail.locator("li")).toHaveCount(1);
  await expect(rail.locator(".work-select")).toHaveAttribute(
    "aria-pressed",
    "true",
  );
  await expect(rail.locator(".badge")).toContainText("In progress");
});

test("a failed completion keeps the original status and retry reuses its write identity", async ({
  page,
}) => {
  const credentials = JSON.parse(readFileSync("data/e2e-login.json", "utf8"));
  await page.request.post("/api/auth/login", { data: credentials });
  const snapshot = await (await page.request.get("/api/workspace")).json();
  const task = leafTasks(snapshot.tasks).find(
    (task) => task.status !== "done",
  )!;
  const keys: string[] = [];
  let fail = true;
  expectedFailures.add(`/api/tasks/${task.id}:503`);
  await page.route(`**/api/tasks/${task.id}`, (route) => {
    keys.push(route.request().headers()["idempotency-key"]!);
    return fail
      ? route.fulfill({
          status: 503,
          contentType: "application/json",
          body: JSON.stringify({ message: "Synthetic completion outage" }),
        })
      : route.continue();
  });
  await page.goto(`/tasks?scope=all&project=${task.projectId}`);
  const checkbox = page.getByRole("checkbox", {
    name: `Complete ${task.title}`,
    exact: true,
  });
  await checkbox.click();
  await expect(page.getByRole("alert")).toContainText(
    "Synthetic completion outage",
  );
  await expect(checkbox).not.toBeChecked();
  await expect(page.locator(".task-feedback")).toHaveCount(0);
  fail = false;
  await checkbox.click();
  await expect(checkbox).toBeChecked();
  expect(keys).toHaveLength(2);
  expect(keys[0]).toBe(keys[1]);
  await page.reload();
  await expect(checkbox).toBeChecked();
  await expect(page.locator(".task-feedback")).toHaveCount(0);
});

test("planned cards select by keyboard and scrolling, expose more work and preserve intake recovery", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto("/demo/projects");
  await page
    .getByRole("button", { name: "Changes & next work", exact: true })
    .click();
  const rail = page.getByRole("list", {
    name: "Planned task cards",
    exact: true,
  });
  const cards = rail.locator("li");
  await expect(cards).toHaveCount(4);
  await rail.focus();
  await rail.press("ArrowRight");
  await expect(cards.nth(1).locator(".work-select")).toHaveAttribute(
    "aria-pressed",
    "true",
  );
  await expect
    .poll(() => rail.evaluate((el) => el.scrollLeft))
    .toBeGreaterThan(0);
  await rail.press("Home");
  await expect(cards.first().locator(".work-select")).toHaveAttribute(
    "aria-pressed",
    "true",
  );
  await rail.evaluate((el) => {
    el.scrollLeft = el.scrollWidth;
  });
  await expect(cards.last().locator(".work-select")).toHaveAttribute(
    "aria-pressed",
    "true",
  );
  await page
    .getByRole("button", { name: "Show 4 more tasks", exact: true })
    .click();
  await expect(cards).toHaveCount(8);
  await expect(cards.nth(4).locator(".work-select")).toBeFocused();
  await rail.scrollIntoViewIfNeeded();
  await page.screenshot({
    path: "artifacts/interaction-feedback/planned-mobile.png",
  });
  await noOverflow(page);
  expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
  await page
    .locator(".heading-actions")
    .getByRole("link", { name: "Quick intake", exact: true })
    .click();
  await page
    .getByLabel("Notes or pasted table", { exact: true })
    .fill("项目：合成交互验收；任务：检查恢复");
  page.once("dialog", (d) => d.accept());
  await page.goBack();
  await expect(page.locator(".next-work")).toBeVisible();
  await page
    .locator(".heading-actions")
    .getByRole("link", { name: "Quick intake", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Restore draft", exact: true })
    .click();
  await expect(
    page.getByLabel("Notes or pasted table", { exact: true }),
  ).toHaveValue("项目：合成交互验收；任务：检查恢复");
});

test("formal undo rejects a concurrent later edit and retains the newer values", async ({
  page,
}) => {
  const credentials = JSON.parse(readFileSync("data/e2e-login.json", "utf8"));
  const login = await page.request.post("/api/auth/login", {
    data: credentials,
  });
  const csrf = (await login.json()).csrf;
  const initial = await (await page.request.get("/api/workspace")).json();
  const task = leafTasks(initial.tasks).find((task) => task.status !== "done")!;
  await page.goto(`/tasks?scope=all&project=${task.projectId}`);
  await page
    .getByRole("checkbox", { name: `Complete ${task.title}`, exact: true })
    .click();
  await expect(
    page.getByRole("button", { name: "Undo status change", exact: true }),
  ).toBeEnabled();
  const saved = (
    await (await page.request.get("/api/workspace")).json()
  ).tasks.find((row: { id: string }) => row.id === task.id);
  const update = await page.request.put(`/api/tasks/${task.id}`, {
    headers: { "x-csrf-token": csrf, "idempotency-key": randomUUID() },
    data: {
      ...taskInput.strip().parse(saved),
      description: "Synthetic later edit from another session",
      version: saved.version,
    },
  });
  expect(update.ok()).toBe(true);
  expectedFailures.add(
    `/api/activities/${(await (await page.request.get("/api/workspace")).json()).activities.find((event: { kind: string; entityId: string; after: { version: number } }) => event.kind === "task" && event.entityId === task.id && event.after.version === saved.version).id}/restore:409`,
  );
  await page
    .getByRole("button", { name: "Undo status change", exact: true })
    .click();
  await expect(page.locator(".task-feedback")).toContainText(
    "This task changed after your action",
  );
  await expect(
    page.getByRole("button", { name: "Undo status change", exact: true }),
  ).toHaveCount(0);
  const current = (
    await (await page.request.get("/api/workspace")).json()
  ).tasks.find((row: { id: string }) => row.id === task.id);
  expect(current.description).toBe("Synthetic later edit from another session");
  expect(current.status).toBe("done");
});
