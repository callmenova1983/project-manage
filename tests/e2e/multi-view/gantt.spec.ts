import { expect, test, type Page, type Locator } from "@playwright/test";
import {
  resetWorkspace,
  snapshot,
  sessions,
  mutationHeaders,
  origin,
} from "./support";

test.beforeEach(async ({ page }) => resetWorkspace(page));
async function open(page: Page) {
  await page.goto(
    "/projects/project-1?scope=all&view=gantt&ganttDate=2026-10-17&ganttScale=day",
  );
  const bar = page.getByRole("button", { name: /^Review design direction: / });
  await expect(bar).toBeVisible();
  return bar;
}
async function begin(
  page: Page,
  bar: Locator,
  edge: "move" | "start" | "end",
  delta: number,
) {
  const target = edge === "move" ? bar : bar.locator(`[data-edge="${edge}"]`);
  const box = await target.boundingBox();
  expect(box).not.toBeNull();
  await page.mouse.move(box!.x + box!.width / 2, box!.y + box!.height / 2);
  await page.mouse.down();
  await page.mouse.move(
    box!.x + box!.width / 2 + delta,
    box!.y + box!.height / 2,
    { steps: 5 },
  );
}
test("gantt cancellation and Escape do not write or leave ghost bars", async ({
  page,
}) => {
  const before = await snapshot(page);
  const bar = await open(page);
  let writes = 0;
  page.on("request", (request) => {
    if (
      request.method() === "PATCH" &&
      request.url().endsWith("/api/tasks/task-3/schedule")
    )
      writes++;
  });
  await begin(page, bar, "move", 28);
  await expect(page.locator(".drag-preview")).toHaveCount(1);
  expect(writes).toBe(0);
  await page.mouse.up();
  const dialog = page.getByRole("dialog", {
    name: "Edit schedule",
    exact: true,
  });
  await expect(
    dialog.getByLabel("Schedule start", { exact: true }),
  ).toHaveValue("2026-10-20");
  await expect(dialog.getByLabel("Schedule end", { exact: true })).toHaveValue(
    "2026-10-22",
  );
  page.once("dialog", (confirmation) => confirmation.accept());
  await dialog.getByRole("button", { name: "Cancel", exact: true }).click();
  await expect(dialog).not.toBeVisible();
  await expect(page.locator(".drag-preview")).toHaveCount(0);
  expect((await snapshot(page)).tasks).toEqual(before.tasks);
  await begin(page, bar, "end", 28);
  await page.keyboard.press("Escape");
  await page.mouse.up();
  await expect(dialog).not.toBeVisible();
  await expect(page.locator(".drag-preview")).toHaveCount(0);
  expect(writes).toBe(0);
  expect((await snapshot(page)).tasks).toEqual(before.tasks);
});

test("moving and each endpoint resize commit once per confirmed gesture and leave other dates unchanged", async ({
  page,
}) => {
  const before = await snapshot(page);
  const original = before.tasks.find((task) => task.id === "task-3")!;
  const bar = await open(page);
  let writes = 0;
  page.on("request", (request) => {
    if (
      request.method() === "PATCH" &&
      request.url().endsWith("/api/tasks/task-3/schedule")
    )
      writes++;
  });
  const cases = [
    { edge: "move", delta: 28, start: "2026-10-20", end: "2026-10-22" },
    { edge: "end", delta: 28, start: "2026-10-20", end: "2026-10-23" },
    { edge: "start", delta: -28, start: "2026-10-19", end: "2026-10-23" },
  ] as const;
  for (const [index, operation] of cases.entries()) {
    await begin(page, bar, operation.edge, operation.delta);
    expect(writes).toBe(index);
    await page.mouse.up();
    const dialog = page.getByRole("dialog", {
      name: "Edit schedule",
      exact: true,
    });
    await expect(
      dialog.getByLabel("Schedule start", { exact: true }),
    ).toHaveValue(operation.start);
    await expect(
      dialog.getByLabel("Schedule end", { exact: true }),
    ).toHaveValue(operation.end);
    await dialog.getByRole("button", { name: "Save", exact: true }).click();
    await expect(dialog).not.toBeVisible();
    expect(writes).toBe(index + 1);
    const current = (await snapshot(page)).tasks.find(
      (task) => task.id === original.id,
    )!;
    expect(current).toMatchObject({
      ...original,
      scheduleStart: operation.start,
      scheduleEnd: operation.end,
      version: original.version + index + 1,
      updatedAt: current.updatedAt,
    });
    await expect(page.locator(".drag-preview")).toHaveCount(0);
  }
  const after = await snapshot(page);
  for (const task of before.tasks.filter((task) => task.id !== original.id))
    expect(after.tasks.find((row) => row.id === task.id)).toEqual(task);
  expect(
    after.activities.filter(
      (activity) =>
        activity.entityId === original.id &&
        activity.action === "Updated task schedule",
    ),
  ).toHaveLength(3);
});

test("schedule conflict preserves the proposed dates until explicit latest-version reload", async ({
  page,
  browser,
}) => {
  const identities = await sessions();
  const other = await browser.newContext({
    baseURL: origin,
    storageState: identities[1]!.state,
  });
  try {
    const before = await snapshot(page);
    const original = before.tasks.find((task) => task.id === "task-3")!;
    const bar = await open(page);
    await begin(page, bar, "move", 28);
    await page.mouse.up();
    const dialog = page.getByRole("dialog", {
      name: "Edit schedule",
      exact: true,
    });
    const competitor = await other.request.patch("/api/tasks/task-3/schedule", {
      headers: mutationHeaders(identities[1]!),
      data: {
        version: original.version,
        scheduleStart: "2026-10-18",
        scheduleEnd: "2026-10-20",
        milestone: false,
      },
    });
    expect(competitor.status()).toBe(200);
    const conflict = page.waitForResponse(
      (response) =>
        response.request().method() === "PATCH" &&
        response.url().endsWith("/api/tasks/task-3/schedule"),
    );
    await dialog.getByRole("button", { name: "Save", exact: true }).click();
    expect((await conflict).status()).toBe(409);
    await expect(
      dialog.getByLabel("Schedule start", { exact: true }),
    ).toHaveValue("2026-10-20");
    await expect(
      dialog.getByLabel("Schedule end", { exact: true }),
    ).toHaveValue("2026-10-22");
    expect(
      (await snapshot(page)).tasks.find((task) => task.id === original.id)!
        .scheduleStart,
    ).toBe("2026-10-18");
    page.once("dialog", (confirmation) => confirmation.accept());
    await dialog
      .getByRole("button", { name: "Load latest version", exact: true })
      .click();
    await expect(
      dialog.getByLabel("Schedule start", { exact: true }),
    ).toHaveValue("2026-10-18");
    await expect(
      dialog.getByLabel("Schedule end", { exact: true }),
    ).toHaveValue("2026-10-20");
    await dialog.getByRole("button", { name: "Cancel", exact: true }).click();
    await expect(page.locator(".drag-preview")).toHaveCount(0);
    expect(
      (await snapshot(page)).tasks.find((task) => task.id === original.id)!
        .version,
    ).toBe(original.version + 1);
  } finally {
    await other.close();
  }
});

test("a lost schedule response retries the same request key without duplicate writes or audit", async ({
  page,
}) => {
  const original = (await snapshot(page)).tasks.find(
    (task) => task.id === "task-3",
  )!;
  const bar = await open(page);
  const keys: string[] = [];
  let dropped = false;
  await page.route("**/api/tasks/task-3/schedule", async (route) => {
    keys.push(route.request().headers()["idempotency-key"]!);
    if (!dropped) {
      dropped = true;
      const receipt = await route.fetch();
      expect(receipt.status()).toBe(200);
      await route.abort("failed");
    } else await route.continue();
  });
  await begin(page, bar, "move", 28);
  await page.mouse.up();
  const dialog = page.getByRole("dialog", {
    name: "Edit schedule",
    exact: true,
  });
  await dialog.getByRole("button", { name: "Save", exact: true }).click();
  await expect(dialog.getByRole("alert")).toContainText(
    "Changes could not be saved",
  );
  await expect(
    dialog.getByLabel("Schedule start", { exact: true }),
  ).toHaveValue("2026-10-20");
  expect(
    (await snapshot(page)).tasks.find((task) => task.id === original.id)!
      .version,
  ).toBe(original.version + 1);
  await expect(page.locator(".drag-preview")).toHaveCount(0);
  await dialog.getByRole("button", { name: "Save", exact: true }).click();
  await expect(dialog).not.toBeVisible();
  expect(keys).toHaveLength(2);
  expect(keys[0]).toBeTruthy();
  expect(keys[1]).toBe(keys[0]);
  const after = await snapshot(page);
  expect(after.tasks.find((task) => task.id === original.id)!.version).toBe(
    original.version + 1,
  );
  expect(
    after.activities.filter(
      (activity) =>
        activity.entityId === original.id &&
        activity.action === "Updated task schedule",
    ),
  ).toHaveLength(1);
  await page.reload();
  await expect(
    page.getByRole("button", { name: /^Review design direction: / }),
  ).toHaveAttribute("aria-label", /Oct 20, 2026.*Oct 22, 2026/);
});
