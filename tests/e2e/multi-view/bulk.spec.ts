import { test, expect } from "@playwright/test";
import {
  resetWorkspace,
  snapshot,
  sessions,
  mutationHeaders,
  origin,
} from "./support";

test.beforeEach(async ({ page }) => resetWorkspace(page));

test("project search accepts full pinyin and initials on a real authenticated workspace", async ({
  page,
}) => {
  await page.goto("/projects");
  for (const query of ["shanghaigongchang", "shgc", "SH GC"]) {
    await page
      .getByRole("textbox", { name: "Search projects", exact: true })
      .fill(query);
    const list = page.getByRole("region", {
      name: "Projects list",
      exact: true,
    });
    await expect(list.getByRole("article")).toHaveCount(1);
    await expect(
      list.getByRole("link", { name: "上海工厂", exact: true }),
    ).toBeVisible();
  }
});

test("bulk status saves exactly the chosen tasks and retains schedule and work dates", async ({
  page,
}) => {
  const before = await snapshot(page);
  await page.goto("/tasks?scope=all&project=project-1");
  await page
    .getByRole("button", { name: "Bulk edit tasks", exact: true })
    .click();
  const dialog = page.getByRole("dialog", {
    name: "Bulk edit tasks",
    exact: true,
  });
  await expect(dialog).toContainText("8 tasks in opening scope");
  await dialog
    .getByRole("checkbox", { name: /^Confirm project scope / })
    .check();
  await dialog
    .getByRole("checkbox", { name: /^Share discovery notes / })
    .check();
  await dialog
    .getByRole("combobox", { name: "New status", exact: true })
    .selectOption("blocked");
  await expect(dialog).toContainText("2 tasks will change");
  await dialog
    .getByRole("checkbox", {
      name: "I confirm replacing this field on the selected tasks.",
      exact: true,
    })
    .check();
  await dialog
    .getByRole("button", { name: "Apply selected changes", exact: true })
    .click();
  await expect(dialog).toContainText("Confirmed 2 selected tasks.");
  const after = await snapshot(page);
  for (const task of before.tasks) {
    const current = after.tasks.find((row) => row.id === task.id)!;
    if (["task-1", "task-2"].includes(task.id)) {
      expect(current).toMatchObject({
        ...task,
        status: "blocked",
        version: task.version + 1,
        updatedAt: current.updatedAt,
      });
    } else expect(current).toEqual(task);
  }
});

test("bulk conflict writes no partial result, retains selection and requires explicit version reload", async ({
  page,
  browser,
}) => {
  const allSessions = await sessions();
  const other = await browser.newContext({
    baseURL: origin,
    storageState: allSessions[1]!.state,
  });
  try {
    const before = await snapshot(page);
    await page.goto("/tasks?scope=all&project=project-1");
    await page
      .getByRole("button", { name: "Bulk edit tasks", exact: true })
      .click();
    const dialog = page.getByRole("dialog", {
      name: "Bulk edit tasks",
      exact: true,
    });
    await dialog
      .getByRole("checkbox", { name: /^Confirm project scope / })
      .check();
    await dialog
      .getByRole("checkbox", { name: /^Share discovery notes / })
      .check();
    await dialog
      .getByRole("combobox", { name: "New status", exact: true })
      .selectOption("blocked");
    await dialog
      .getByRole("checkbox", {
        name: "I confirm replacing this field on the selected tasks.",
        exact: true,
      })
      .check();
    const task = before.tasks.find((row) => row.id === "task-2")!;
    const competitor = await other.request.post("/api/tasks/bulk-update", {
      headers: mutationHeaders(allSessions[1]!),
      data: {
        targets: [{ id: task.id, version: task.version }],
        change: { field: "status", value: "done" },
      },
    });
    expect(competitor.status()).toBe(200);
    const conflict = page.waitForResponse(
      (response) =>
        response.url().endsWith("/api/tasks/bulk-update") &&
        response.request().method() === "POST",
    );
    await dialog
      .getByRole("button", { name: "Apply selected changes", exact: true })
      .click();
    expect((await conflict).status()).toBe(409);
    await expect(
      dialog.getByRole("button", {
        name: "Reload selected task versions",
        exact: true,
      }),
    ).toBeVisible();
    await expect(dialog).toContainText("2 selected");
    const failed = await snapshot(page);
    expect(failed.tasks.find((row) => row.id === "task-1")).toEqual(
      before.tasks.find((row) => row.id === "task-1"),
    );
    expect(failed.tasks.find((row) => row.id === "task-2")!.status).toBe(
      "done",
    );
    await dialog
      .getByRole("button", {
        name: "Reload selected task versions",
        exact: true,
      })
      .click();
    await expect(
      dialog.getByRole("checkbox", {
        name: "I confirm replacing this field on the selected tasks.",
        exact: true,
      }),
    ).not.toBeChecked();
    await dialog
      .getByRole("checkbox", {
        name: "I confirm replacing this field on the selected tasks.",
        exact: true,
      })
      .check();
    await dialog
      .getByRole("button", { name: "Apply selected changes", exact: true })
      .click();
    await expect(dialog).toContainText("Confirmed 2 selected tasks.");
    const after = await snapshot(page);
    expect(
      after.tasks
        .filter((row) => ["task-1", "task-2"].includes(row.id))
        .every((row) => row.status === "blocked"),
    ).toBe(true);
  } finally {
    await other.close();
  }
});
