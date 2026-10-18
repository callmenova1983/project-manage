import { expect, test, type Locator, type Page } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { mkdirSync } from "node:fs";
import type { WorkspaceApi } from "../../apps/web/src/services/contracts";

type Fixture = {
  projectId: string;
  taskId: string;
  title: string;
  taskIds: string[];
};

async function fixture(page: Page): Promise<Fixture> {
  await page.addInitScript(() => {
    localStorage.setItem("project-manage-locale", "en");
    localStorage.setItem("project-manage-theme", "light");
  });
  await page.goto("/demo/projects");
  await expect(page.locator(".project-record").first()).toBeVisible();
  return page.evaluate(async () => {
    const localPath = "/src/services/local.ts";
    const calendarPath = "/src/composables/calendar.ts";
    const { createLocalApi } = (await import(localPath)) as {
      createLocalApi: () => WorkspaceApi;
    };
    const { currentDay, currentWeek } = (await import(calendarPath)) as {
      currentDay: () => string;
      currentWeek: () => string;
    };
    const local = createLocalApi();
    if (local.mode !== "local") throw new Error("Demo storage required");
    const project = await local.saveProject({
      name: "Task experience acceptance",
      client: "Synthetic client",
      channelId: "company",
      description: "Isolated browser-only task experience fixture.",
      stage: "proposal",
      owner: "Experience owner",
      discipline: "Sales",
      latestUpdate: "Reviewing the task workspace.",
      notes: "",
      aliases: [],
    });
    let first: { id: string; title: string } | undefined;
    const taskIds: string[] = [];
    for (let index = 1; index <= 12; index++) {
      const task = await local.saveTask({
        projectId: project.id,
        parentId: null,
        title: `Review workflow ${String(index).padStart(2, "0")}`,
        description: "Confirm the user can understand and act on this task.",
        status: index > 10 ? "done" : "todo",
        assignee: "Experience owner",
        dueDate: currentDay(),
        workWeek: currentWeek(),
        workDates: [currentDay()],
      });
      first ??= task;
      taskIds.push(task.id);
    }
    if (!first) throw new Error("Task fixture was not created");
    return {
      projectId: project.id,
      taskId: first.id,
      title: first.title,
      taskIds,
    };
  });
}

async function openTasks(page: Page, data: Fixture) {
  await page.goto(`/demo/tasks?scope=all&project=${data.projectId}&view=list`);
  await expect(page.locator(".task-row")).toHaveCount(12);
}

async function openListDetails(page: Page, data: Fixture) {
  const trigger = page.locator(`#task-${data.taskId}`).getByRole("button", {
    name: `More actions for ${data.title}`,
    exact: true,
  });
  await trigger.click();
  await page
    .getByRole("dialog", { name: "Task actions", exact: true })
    .getByRole("button", { name: "Task details", exact: true })
    .click();
  return trigger;
}

async function noOverflow(page: Page) {
  const dimensions = await page.evaluate(() => ({
    viewport: innerWidth,
    width: document.documentElement.scrollWidth,
    overflowing: [...document.querySelectorAll("body *")]
      .map((element) => ({
        element: element.tagName.toLowerCase(),
        class: element.className?.toString(),
        id: element.id,
        left: element.getBoundingClientRect().left,
        right: element.getBoundingClientRect().right,
      }))
      .filter((item) => item.right > innerWidth + 1 || item.left < -1)
      .slice(0, 10),
  }));
  expect(dimensions.width, JSON.stringify(dimensions)).toBeLessThanOrEqual(
    dimensions.viewport + 1,
  );
  for (const dialog of await page.locator("dialog:visible").all()) {
    expect(
      await dialog.evaluate(
        (element) => element.scrollWidth <= element.clientWidth + 1,
      ),
    ).toBe(true);
  }
}

async function touchTarget(control: Locator) {
  await expect(control).toBeVisible();
  const box = await control.boundingBox();
  expect(box).not.toBeNull();
  expect(box!.width).toBeGreaterThanOrEqual(44);
  expect(box!.height).toBeGreaterThanOrEqual(44);
}

async function accessible(page: Page) {
  const result = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa", "wcag21aa"])
    .analyze();
  expect(result.violations).toEqual([]);
}

async function dragTask(
  page: Page,
  sourceId: string,
  targetId: string,
  placement: "before" | "inside" | "after",
  invalidHint?: string,
) {
  const target = page.locator(`#task-${targetId}`);
  if (invalidHint) {
    const source = page.locator(`#task-${sourceId} [data-task-drag-handle]`);
    await source.scrollIntoViewIfNeeded();
    const sourceBox = (await source.boundingBox())!;
    await page.mouse.move(
      sourceBox.x + sourceBox.width / 2,
      sourceBox.y + sourceBox.height / 2,
    );
    await page.mouse.down();
    await page.mouse.move(
      sourceBox.x + sourceBox.width / 2 + 12,
      sourceBox.y + sourceBox.height / 2 + 10,
      { steps: 5 },
    );
    await target.scrollIntoViewIfNeeded();
    const targetBox = (await target.boundingBox())!;
    await page.mouse.move(
      targetBox.x + Math.min(400, targetBox.width - 10),
      targetBox.y + targetBox.height / 2,
      { steps: 12 },
    );
    await page.mouse.move(
      targetBox.x + Math.min(400, targetBox.width - 10) + 2,
      targetBox.y + targetBox.height / 2,
      { steps: 2 },
    );
    await expect(page.locator(".task-drop-hint")).toContainText(invalidHint);
    await page.mouse.up();
    return;
  }
  await target.scrollIntoViewIfNeeded();
  const box = await target.boundingBox();
  expect(box).not.toBeNull();
  await page
    .locator(`#task-${sourceId} [data-task-drag-handle]`)
    .dragTo(target, {
      targetPosition: {
        x: Math.min(400, box!.width - 10),
        y:
          placement === "before"
            ? 3
            : placement === "after"
              ? box!.height - 3
              : box!.height / 2,
      },
    });
}

async function placement(page: Page, id: string) {
  return page.evaluate(async (id) => {
    const localPath = "/src/services/local.ts";
    const { createLocalApi } = (await import(localPath)) as {
      createLocalApi: () => WorkspaceApi;
    };
    const state = await createLocalApi().snapshot();
    const task = state.tasks.find((task) => task.id === id);
    if (!task) throw new Error("Fixture task is missing");
    return {
      parentId: task.parentId,
      projectId: task.projectId,
      sortOrder: task.sortOrder,
    };
  }, id);
}

test.describe("global task experience", () => {
  test.use({ viewport: { width: 1440, height: 900 }, colorScheme: "light" });

  test.beforeEach(async ({ page }) => {
    // These tests deliberately exercise the browser demo, never the shared API.
    await page.route("**/api/**", (route) => route.abort());
  });

  test("distinguishes nested tasks and aligns the calendar controls", async ({
    page,
  }) => {
    const data = await fixture(page);
    await page.evaluate(async ({ taskIds }) => {
      const path = "/src/services/local.ts";
      const { createLocalApi } = (await import(path)) as {
        createLocalApi: () => WorkspaceApi;
      };
      const local = createLocalApi();
      for (const [childId, parentId] of [
        [taskIds[1], taskIds[0]],
        [taskIds[2], taskIds[1]],
      ]) {
        const state = await local.snapshot();
        const child = state.tasks.find((task) => task.id === childId)!;
        const parent = state.tasks.find((task) => task.id === parentId)!;
        await local.moveTask(child.id, {
          version: child.version,
          parentId: parent.id,
          parentVersion: parent.version,
          placement: "last",
        });
      }
    }, data);
    await page.goto(
      `/demo/tasks?scope=all&project=${data.projectId}&view=list`,
    );
    const parent = page.locator(`#task-${data.taskIds[0]}`);
    const child = page.locator(`#task-${data.taskIds[1]}`);
    const grandchild = page.locator(`#task-${data.taskIds[2]}`);
    await expect(parent.locator(".task-parent-summary")).toHaveText("Rollup");
    await expect(
      parent.locator(".task-title-line .task-child-count"),
    ).toHaveText("0/1");
    await expect(child).toBeVisible();
    await expect(grandchild).toBeVisible();
    const heights = await page
      .locator(".task-row")
      .evaluateAll((els) => els.map((el) => el.getBoundingClientRect().height));
    expect(Math.max(...heights)).toBeLessThanOrEqual(42);
    const titleBox = await parent.locator(".task-title-main").boundingBox();
    const countBox = await parent.locator(".task-child-count").boundingBox();
    expect(
      Math.abs(
        titleBox!.y + titleBox!.height / 2 - countBox!.y - countBox!.height / 2,
      ),
    ).toBeLessThanOrEqual(2);
    const indent = async (row: Locator) =>
      row
        .locator(".task-name")
        .evaluate((el) => parseFloat(getComputedStyle(el).paddingLeft));
    expect(await indent(grandchild)).toBeGreaterThan(await indent(child));
    expect(
      await parent.evaluate((el) => getComputedStyle(el).backgroundColor),
    ).not.toBe(
      await grandchild.evaluate((el) => getComputedStyle(el).backgroundColor),
    );
    await parent
      .getByRole("button", {
        name: `Collapse subtasks for ${data.title}`,
        exact: true,
      })
      .click();
    await expect(child).toHaveCount(0);
    await expect(grandchild).toHaveCount(0);
    await parent
      .getByRole("button", {
        name: `Expand subtasks for ${data.title}`,
        exact: true,
      })
      .click();
    await expect(grandchild).toBeVisible();
    await noOverflow(page);
    await accessible(page);
    mkdirSync("artifacts/task-experience", { recursive: true });
    await page.screenshot({
      path: "artifacts/task-experience/task-hierarchy-desktop.png",
    });
    await page.setViewportSize({ width: 390, height: 844 });
    await noOverflow(page);
    await touchTarget(parent.locator(".task-details-toggle"));
    await page.screenshot({
      path: "artifacts/task-experience/task-hierarchy-mobile.png",
    });
    await page.setViewportSize({ width: 1440, height: 1000 });
    await page.goto(
      `/demo/tasks?scope=week&project=${data.projectId}&view=calendar&calendarMode=month`,
    );
    const calendar = page.locator(".task-calendar");
    await expect(calendar.locator(".calendar-navigation h2")).toBeVisible();
    await expect(calendar.locator(".calendar-day")).toHaveCount(42);
    await expect(calendar.locator(".empty-day")).toHaveCount(0);
    const tops = await calendar
      .locator(".calendar-options > *")
      .evaluateAll((els) => els.map((el) => el.getBoundingClientRect().top));
    expect(Math.max(...tops) - Math.min(...tops)).toBeLessThanOrEqual(6);
    await noOverflow(page);
    await accessible(page);
    await calendar.screenshot({
      path: "artifacts/task-experience/calendar-layout-desktop.png",
    });
    await calendar
      .getByRole("button", { name: "Next date window", exact: true })
      .click();
    await expect(page).toHaveURL(/date=/);
    await calendar.getByRole("button", { name: "Today", exact: true }).click();
    await expect(page).not.toHaveURL(/[?&]date=/);
    await calendar.getByRole("button", { name: "Week", exact: true }).click();
    await expect(calendar.locator(".calendar-day")).toHaveCount(7);
    await expect(page).toHaveURL(/calendarMode=week/);
    await page.setViewportSize({ width: 390, height: 844 });
    await calendar.getByRole("button", { name: "Agenda", exact: true }).click();
    await noOverflow(page);
    await touchTarget(
      calendar.getByRole("button", { name: "Next date window", exact: true }),
    );
    await accessible(page);
    await page.screenshot({
      path: "artifacts/task-experience/calendar-layout-mobile.png",
    });
  });

  test("puts real task rows in the first screen and keeps display options behind settings", async ({
    page,
  }, info) => {
    const data = await fixture(page);
    await openTasks(page, data);
    const rows = page.locator(".task-row");
    const first = await rows.first().boundingBox();
    expect(first).not.toBeNull();
    expect(first!.y).toBeLessThanOrEqual(280);
    const visibleRows = await rows.evaluateAll(
      (elements) =>
        elements.filter((element) => {
          const box = element.getBoundingClientRect();
          return box.top >= 0 && box.bottom <= innerHeight;
        }).length,
    );
    expect(visibleRows).toBeGreaterThanOrEqual(8);
    await expect(
      page.getByRole("button", { name: "Filter tasks", exact: true }),
    ).toBeVisible();
    await expect(
      page.getByRole("button", { name: "View settings", exact: true }),
    ).toBeVisible();
    await expect(page.getByLabel("Group tasks", { exact: true })).toBeHidden();
    await expect(
      page.getByText("Columns and density", { exact: true }),
    ).toBeHidden();
    await noOverflow(page);
    await page.screenshot({ path: info.outputPath("tasks-desktop.png") });

    await page
      .getByRole("button", { name: "View settings", exact: true })
      .click();
    const settings = page.getByRole("dialog", {
      name: "View settings",
      exact: true,
    });
    await expect(
      settings.getByLabel("Group tasks", { exact: true }),
    ).toBeVisible();
    await expect(
      settings.getByLabel("Sort tasks", { exact: true }),
    ).toBeVisible();
    await noOverflow(page);
    await settings
      .getByRole("button", { name: "Close View settings", exact: true })
      .click();
    await expect(rows).toHaveCount(12);
  });

  test("explains an empty selection and restores work by removing one condition", async ({
    page,
  }) => {
    const data = await fixture(page);
    await openTasks(page, data);
    const query = "No task can match this acceptance query";
    await page
      .getByRole("searchbox", { name: "Search tasks", exact: true })
      .fill(query);
    await expect(page.locator(".task-row")).toHaveCount(0);
    await expect(
      page.getByRole("heading", {
        name: "No tasks match these filters",
        exact: true,
      }),
    ).toBeVisible();
    await expect(
      page.getByRole("button", { name: "View all tasks", exact: true }),
    ).toBeVisible();
    await page
      .getByRole("button", {
        name: `Remove filter Search: ${query}`,
        exact: true,
      })
      .click();
    await expect(page.locator(".task-row")).toHaveCount(12);
    await expect(
      page.getByRole("searchbox", { name: "Search tasks", exact: true }),
    ).toHaveValue("");
    expect(new URL(page.url()).searchParams.get("project")).toBe(
      data.projectId,
    );

    await page
      .getByRole("button", { name: "Filter tasks", exact: true })
      .click();
    const filters = page.getByRole("dialog", {
      name: "Filter tasks",
      exact: true,
    });
    await filters
      .getByLabel("Filter task assignee", { exact: true })
      .selectOption("me");
    await filters
      .getByRole("button", { name: "Close Filter tasks", exact: true })
      .click();
    await expect(page.locator(".task-row")).toHaveCount(0);
    await expect(
      page.getByRole("heading", {
        name: "No tasks assigned to you in this view",
        exact: true,
      }),
    ).toBeVisible();
    await page
      .getByRole("button", { name: "Remove assignee filter", exact: true })
      .click();
    await expect(page.locator(".task-row")).toHaveCount(12);
    expect(new URL(page.url()).searchParams.get("project")).toBe(
      data.projectId,
    );
    expect(new URL(page.url()).searchParams.has("assignee")).toBe(false);
  });

  test("keeps search and project conditions across list, board and calendar", async ({
    page,
  }) => {
    const data = await fixture(page);
    await openTasks(page, data);
    await page
      .getByRole("searchbox", { name: "Search tasks", exact: true })
      .fill(data.title);
    await expect(page.locator(".task-row")).toHaveCount(1);
    const views = page.getByRole("group", { name: "Task view", exact: true });
    for (const [name, value, item] of [
      ["Board view", "board", ".board-card"],
      ["Task calendar", "calendar", ".calendar-event"],
      ["List view", "list", ".task-row"],
    ]) {
      await views.getByRole("button", { name, exact: true }).click();
      await expect(
        views.getByRole("button", { name, exact: true }),
      ).toHaveAttribute("aria-pressed", "true");
      await expect(
        page.locator(item).filter({ hasText: data.title }),
      ).toHaveCount(1);
      const url = new URL(page.url());
      expect(url.searchParams.get("view")).toBe(value);
      expect(url.searchParams.get("q")).toBe(data.title);
      expect(url.searchParams.get("project")).toBe(data.projectId);
      await expect(
        page.getByRole("searchbox", { name: "Search tasks", exact: true }),
      ).toHaveValue(data.title);
    }
  });

  test("opens details from row actions and returns focus to the same task", async ({
    page,
  }, info) => {
    const data = await fixture(page);
    await openTasks(page, data);
    const row = page.locator(`#task-${data.taskId}`);
    const before = page.url();
    const trigger = await openListDetails(page, data);
    const details = page.getByRole("dialog", {
      name: "Task details",
      exact: true,
    });
    await expect(details).toBeVisible();
    await expect(
      details.getByRole("heading", { name: data.title, exact: true }),
    ).toBeVisible();
    await expect(details).toContainText(
      "Confirm the user can understand and act on this task.",
    );
    await noOverflow(page);
    await page.screenshot({ path: info.outputPath("task-detail-desktop.png") });
    await details
      .getByRole("button", { name: "Close Task details", exact: true })
      .click();
    await expect(details).toBeHidden();
    await expect(trigger).toBeFocused();
    expect(page.url()).toBe(before);
    await expect(row).toBeInViewport();
  });

  test("creates a task with only its title and exposes optional scheduling on demand", async ({
    page,
  }) => {
    const data = await fixture(page);
    await openTasks(page, data);
    await page.getByRole("button", { name: "New task", exact: true }).click();
    const creation = page.getByRole("dialog", {
      name: "New task",
      exact: true,
    });
    await expect(
      creation.getByLabel("Project for new task", { exact: true }),
    ).toHaveValue(data.projectId);
    await expect(
      creation.getByRole("combobox", { name: "Status", exact: true }),
    ).toBeHidden();
    await expect(
      creation.getByLabel("Estimated date", { exact: false }),
    ).toBeHidden();
    await expect(creation.locator('input[type="datetime-local"]')).toBeHidden();
    await creation.getByText("More task options", { exact: true }).click();
    await expect(
      creation.getByRole("combobox", { name: "Status", exact: true }),
    ).toBeVisible();
    await expect(
      creation.locator('input[type="datetime-local"]'),
    ).toBeVisible();
    await creation.getByText("More task options", { exact: true }).click();
    const title = "Created with only the essential title";
    await creation
      .getByRole("textbox", { name: "Task title", exact: true })
      .fill(title);
    await creation
      .getByRole("button", { name: "Save task", exact: true })
      .click();
    await expect(creation).toBeHidden();
    await expect(page.locator(".task-row")).toHaveCount(13);
    await expect(
      page.getByRole("button", {
        name: `Edit title for ${title}`,
        exact: true,
      }),
    ).toBeVisible();
    await page.reload();
    await expect(page.locator(".task-row")).toHaveCount(13);
    await expect(
      page.getByRole("button", {
        name: `Edit title for ${title}`,
        exact: true,
      }),
    ).toBeVisible();
    expect(new URL(page.url()).searchParams.get("project")).toBe(
      data.projectId,
    );
  });

  test("edits title, owner, due date and status directly in its table row", async ({
    page,
  }) => {
    const data = await fixture(page);
    await openTasks(page, data);
    const row = page.locator(`#task-${data.taskId}`);
    await row
      .getByRole("button", {
        name: `Edit title for ${data.title}`,
        exact: true,
      })
      .click();
    const nextTitle = "Edited directly in the task table";
    await row
      .getByRole("textbox", { name: "Task title", exact: true })
      .fill(nextTitle);
    await row.getByRole("button", { name: "Save", exact: true }).click();
    await expect(
      row.getByRole("button", {
        name: `Edit title for ${nextTitle}`,
        exact: true,
      }),
    ).toBeVisible();
    await expect(
      page.getByRole("dialog", { name: "Task details", exact: true }),
    ).toBeHidden();

    await row
      .getByRole("button", { name: "Assignee: Experience owner", exact: true })
      .click();
    const owner = row.getByRole("combobox", { name: "Assignee", exact: true });
    await owner.fill("Table acceptance owner");
    await owner.press("Enter");
    await expect(
      row.getByRole("button", {
        name: "Assignee: Table acceptance owner",
        exact: true,
      }),
    ).toBeVisible();

    await row.locator(".task-date .field-value").click();
    await row.getByLabel("Due date", { exact: true }).fill("2027-01-20");
    await row.getByRole("button", { name: "Save", exact: true }).click();
    await expect(
      row.getByRole("button", { name: "Due date: 2027-01-20", exact: true }),
    ).toBeVisible();

    const status = row.getByRole("combobox", {
      name: `Status for ${nextTitle}`,
      exact: true,
    });
    const originalColor = await status.evaluate(
      (element) => getComputedStyle(element).color,
    );
    await status.selectOption("in_progress");
    await expect(status).toHaveValue("in_progress");
    await expect
      .poll(() => status.evaluate((element) => getComputedStyle(element).color))
      .not.toBe(originalColor);
    await row
      .getByRole("checkbox", { name: `Complete ${nextTitle}`, exact: true })
      .click();
    await expect(status).toHaveValue("done");
    await expect(
      row.getByRole("checkbox", { name: `Complete ${nextTitle}`, exact: true }),
    ).toHaveAttribute("aria-checked", "true");
    await expect(
      page.getByRole("dialog", { name: "Task details", exact: true }),
    ).toBeHidden();
    await page.reload();
    await expect(
      row.getByRole("button", {
        name: `Edit title for ${nextTitle}`,
        exact: true,
      }),
    ).toBeVisible();
    await expect(
      row.getByRole("button", {
        name: "Assignee: Table acceptance owner",
        exact: true,
      }),
    ).toBeVisible();
    await expect(
      row.getByRole("button", { name: "Due date: 2027-01-20", exact: true }),
    ).toBeVisible();
    await expect(status).toHaveValue("done");
  });

  test("edits the work arrangement in the table without a task dialog", async ({
    page,
  }) => {
    const data = await fixture(page);
    await openTasks(page, data);
    await page
      .locator(`#task-${data.taskId}`)
      .getByRole("button", { name: `Plan work for ${data.title}`, exact: true })
      .click();
    const plan = page
      .locator(".task-inline-panel")
      .filter({ has: page.locator(".inline-date-edit") });
    await expect(plan).toBeVisible();
    await expect(page.locator("dialog[open]")).toHaveCount(0);
    const dates = plan.getByRole("checkbox");
    const selected = await dates.evaluateAll(
      (elements) =>
        elements.filter((element) => (element as HTMLInputElement).checked)
          .length,
    );
    expect(selected).toBeGreaterThan(0);
    await dates.first().check();
    await plan
      .getByRole("button", { name: "Save changes", exact: true })
      .click();
    await expect(plan).toBeHidden();
    await page.reload();
    await page
      .locator(`#task-${data.taskId}`)
      .getByRole("button", { name: `Plan work for ${data.title}`, exact: true })
      .click();
    await expect(plan.getByRole("checkbox").first()).toBeChecked();
    await expect(page.locator("dialog[open]")).toHaveCount(0);
  });

  test("opens the copied view with the same display choices in a clean browser context", async ({
    page,
    browser,
  }) => {
    const data = await fixture(page);
    await openTasks(page, data);
    await page
      .context()
      .grantPermissions(["clipboard-read", "clipboard-write"], {
        origin: "http://127.0.0.1:4173",
      });
    await page
      .getByRole("button", { name: "View settings", exact: true })
      .click();
    const settings = page.getByRole("dialog", {
      name: "View settings",
      exact: true,
    });
    await settings
      .getByLabel("Group tasks", { exact: true })
      .selectOption("project");
    await settings
      .getByLabel("Sort tasks", { exact: true })
      .selectOption("title");
    await settings
      .getByRole("combobox", { name: "Row density", exact: true })
      .selectOption("compact");
    await settings
      .getByRole("checkbox", { name: "Work arrangement", exact: true })
      .uncheck();
    await settings
      .getByRole("button", { name: "Copy view link", exact: true })
      .click();
    const link = await page.evaluate(() => navigator.clipboard.readText());
    const params = new URL(link).searchParams;
    expect(params.get("view")).toBe("list");
    expect(params.get("group")).toBe("project");
    expect(params.get("sort")).toBe("title");
    expect(params.get("density")).toBe("compact");
    expect(params.get("columns")).not.toContain("work");
    const snapshot = await page.evaluate(() =>
      Object.fromEntries(
        Object.entries(localStorage).filter(
          ([key]) => !key.includes("view-preferences"),
        ),
      ),
    );
    const other = await browser.newContext({
      viewport: { width: 1440, height: 900 },
      colorScheme: "light",
    });
    try {
      await other.addInitScript((entries) => {
        for (const [key, value] of Object.entries(entries))
          localStorage.setItem(key, value);
      }, snapshot);
      const clean = await other.newPage();
      await clean.route("**/api/**", (route) => route.abort());
      await clean.goto(link);
      await expect(clean.locator(".task-row")).toHaveCount(12);
      await clean
        .getByRole("button", { name: "View settings", exact: true })
        .click();
      const restored = clean.getByRole("dialog", {
        name: "View settings",
        exact: true,
      });
      await expect(
        restored.getByLabel("Group tasks", { exact: true }),
      ).toHaveValue("project");
      await expect(
        restored.getByLabel("Sort tasks", { exact: true }),
      ).toHaveValue("title");
      await expect(
        restored.getByRole("combobox", { name: "Row density", exact: true }),
      ).toHaveValue("compact");
      await expect(
        restored.getByRole("checkbox", {
          name: "Work arrangement",
          exact: true,
        }),
      ).not.toBeChecked();
    } finally {
      await other.close();
    }
  });

  test("drags to reorder and nest tasks, persists placement and rejects cycles or cross-project drops", async ({
    page,
  }) => {
    const data = await fixture(page);
    await openTasks(page, data);
    const [sourceId, targetId] = data.taskIds;
    const order = () =>
      page
        .locator(".task-row")
        .evaluateAll((elements) => elements.map((element) => element.id));
    await dragTask(page, sourceId!, targetId!, "after");
    await expect(page.locator(".task-move-notice")).toContainText(
      "Task moved. Its subtasks stay with it.",
    );
    await expect
      .poll(async () => {
        const ids = await order();
        return (
          ids.indexOf(`task-${sourceId}`) - ids.indexOf(`task-${targetId}`)
        );
      })
      .toBe(1);
    await page.reload();
    await expect
      .poll(async () => {
        const ids = await order();
        return (
          ids.indexOf(`task-${sourceId}`) - ids.indexOf(`task-${targetId}`)
        );
      })
      .toBe(1);
    await dragTask(page, sourceId!, targetId!, "before");
    await expect(page.locator(".task-move-notice")).toContainText(
      "Task moved. Its subtasks stay with it.",
    );
    await expect
      .poll(async () => {
        const ids = await order();
        return (
          ids.indexOf(`task-${targetId}`) - ids.indexOf(`task-${sourceId}`)
        );
      })
      .toBe(1);
    await page.reload();
    const persistedOrder = await order();
    expect(
      persistedOrder.indexOf(`task-${targetId}`) -
        persistedOrder.indexOf(`task-${sourceId}`),
    ).toBe(1);
    await dragTask(page, sourceId!, targetId!, "inside");
    await expect
      .poll(async () => (await placement(page, sourceId!)).parentId)
      .toBe(targetId);
    await expect(page.locator(`#task-${sourceId}`)).toHaveClass(/subtask/);
    await page.reload();
    await expect(page.locator(`#task-${sourceId}`)).toHaveClass(/subtask/);
    expect((await placement(page, sourceId!)).parentId).toBe(targetId);

    await dragTask(
      page,
      sourceId!,
      sourceId!,
      "inside",
      "A task cannot be moved into itself or its subtasks.",
    );
    expect((await placement(page, sourceId!)).parentId).toBe(targetId);
    await dragTask(
      page,
      targetId!,
      sourceId!,
      "inside",
      "A task cannot be moved into itself or its subtasks.",
    );
    expect((await placement(page, targetId!)).parentId).toBeNull();

    const foreignId = await page.evaluate(async ({ projectId }) => {
      const localPath = "/src/services/local.ts";
      const { createLocalApi } = (await import(localPath)) as {
        createLocalApi: () => WorkspaceApi;
      };
      const local = createLocalApi();
      const state = await local.snapshot();
      const otherProject = state.projects.find(
        (project) => project.id !== projectId,
      );
      if (!otherProject) throw new Error("A second demo project is required");
      const task = await local.saveTask({
        projectId: otherProject.id,
        parentId: null,
        title: "Review workflow foreign",
        description: "Isolated cross-project move guard",
        status: "todo",
        assignee: "Experience owner",
        dueDate: null,
        workWeek: null,
        workDates: [],
      });
      return task.id;
    }, data);
    await page.goto("/demo/tasks?scope=all&view=list&q=Review%20workflow");
    await expect(page.locator(`#task-${foreignId}`)).toBeVisible();
    await dragTask(
      page,
      sourceId!,
      foreignId,
      "inside",
      "Move tasks within the same project.",
    );
    expect(await placement(page, sourceId!)).toMatchObject({
      parentId: targetId,
      projectId: data.projectId,
    });

    await page.locator(`#task-${sourceId} [data-task-drag-handle]`).focus();
    await page.keyboard.press("Alt+ArrowLeft");
    await expect
      .poll(async () => (await placement(page, sourceId!)).parentId)
      .toBeNull();
    await expect(
      page.locator(`#task-${sourceId} [data-task-drag-handle]`),
    ).toBeFocused();
    await page.reload();
    expect((await placement(page, sourceId!)).parentId).toBeNull();

    // Keep review captures tied to the same isolated demo data used above.
    await page.evaluate(async ({ projectId, taskIds }) => {
      const localPath = "/src/services/local.ts";
      const { createLocalApi } = (await import(localPath)) as {
        createLocalApi: () => WorkspaceApi;
      };
      const local = createLocalApi();
      const state = await local.snapshot();
      const project = state.projects.find(
        (project) => project.id === projectId,
      )!;
      await local.renameProject(
        project.id,
        "任务体验改进验收",
        project.version,
      );
      const titles = [
        "完善任务页交互与信息层级",
        "表格内直接修改状态、负责人和截止日期",
        "协调负责人确认交付范围",
        "完成任务详情与移动端布局验收",
        "验证超长任务标题在桌面表格和手机摘要中的显示与编辑，同时保留清晰的操作入口",
      ];
      const statuses = [
        "todo",
        "in_progress",
        "blocked",
        "done",
        "todo",
      ] as const;
      for (let index = 0; index < titles.length; index++) {
        const task = state.tasks.find((task) => task.id === taskIds[index])!;
        await local.saveTask(
          {
            projectId: task.projectId,
            parentId: task.parentId,
            description: task.description,
            dueDate: task.dueDate,
            workWeek: task.workWeek,
            workDates: task.workDates,
            title: titles[index]!,
            status: statuses[index]!,
            assignee: "验收负责人",
          },
          task.id,
          task.version,
        );
      }
      const parent = (await local.snapshot()).tasks.find(
        (task) => task.id === taskIds[0],
      )!;
      await local.saveTask({
        projectId,
        parentId: parent.id,
        title: "核对触控、键盘操作与拖动层级",
        description: "仅用于浏览器演示验收。",
        status: "todo",
        assignee: "协作成员",
        dueDate: parent.dueDate,
        workWeek: parent.workWeek,
        workDates: parent.workDates,
      });
    }, data);
    await page.goto(`/demo/projects/${data.projectId}?scope=all&view=list`);
    await page
      .getByRole("combobox", { name: "Language", exact: true })
      .selectOption("zh-CN");
    await expect(
      page.locator(".project-task-workspace .task-row").first(),
    ).toBeVisible();
    await page.locator(".project-task-workspace").scrollIntoViewIfNeeded();
    mkdirSync("artifacts/task-experience", { recursive: true });
    await page.screenshot({
      path: "artifacts/task-experience/project-task-table-zh.png",
    });
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto(
      `/demo/tasks?scope=all&project=${data.projectId}&view=list`,
    );
    await page
      .getByRole("combobox", { name: "Language", exact: true })
      .selectOption("zh-CN");
    await expect(page.locator(".task-row").first()).toBeVisible();
    await noOverflow(page);
    await page.screenshot({
      path: "artifacts/task-experience/tasks-mobile-zh.png",
    });
  });

  for (const view of ["list", "board", "calendar"] as const) {
    test(`keeps details stable after the last matching task is completed in ${view}`, async ({
      page,
    }) => {
      const errors: string[] = [];
      page.on("pageerror", (error) => errors.push(error.message));
      const data = await fixture(page);
      await page.goto(
        `/demo/tasks?scope=all&focus=open&project=${data.projectId}&view=${view}&q=${encodeURIComponent(data.title)}`,
      );
      if (view === "list") await openListDetails(page, data);
      else {
        const title =
          view === "board"
            ? page
                .locator(".board-card .card-title")
                .filter({ hasText: data.title })
            : page.locator(".calendar-event").filter({ hasText: data.title });
        await expect(title).toHaveCount(1);
        await title.click();
      }
      const details = page.getByRole("dialog", {
        name: "Task details",
        exact: true,
      });
      await expect(details).toBeVisible();
      await details
        .getByLabel(`Status for ${data.title}`, { exact: true })
        .selectOption("done");
      await expect(details).toBeVisible();
      await expect(
        details.getByRole("heading", { name: data.title, exact: true }),
      ).toBeVisible();
      await expect(
        details.getByText("This task is outside the current filters.", {
          exact: true,
        }),
      ).toBeVisible();
      await expect(
        details.getByLabel(`Status for ${data.title}`, { exact: true }),
      ).toHaveValue("done");
      await details
        .getByRole("button", { name: "Close Task details", exact: true })
        .click();
      await expect(
        page.getByRole("heading", {
          name: "No tasks match these filters",
          exact: true,
        }),
      ).toBeVisible();
      await expect(
        page.getByRole("searchbox", { name: "Search tasks", exact: true }),
      ).toBeFocused();
      expect(errors).toEqual([]);
    });
  }

  test("keeps at least three task rows visible at 1040 by 585", async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1040, height: 585 });
    const data = await fixture(page);
    await openTasks(page, data);
    const fullyVisible = await page.locator(".task-row").evaluateAll(
      (elements) =>
        elements.filter((element) => {
          const box = element.getBoundingClientRect();
          return box.top >= 0 && box.bottom <= innerHeight;
        }).length,
    );
    const rowGeometry = await page
      .locator(".task-row")
      .evaluateAll((elements) =>
        elements.slice(0, 4).map((element) => {
          const box = element.getBoundingClientRect();
          return { top: box.top, bottom: box.bottom, height: box.height };
        }),
      );
    expect(fullyVisible, JSON.stringify(rowGeometry)).toBeGreaterThanOrEqual(3);
    await noOverflow(page);
  });

  test("has no WCAG A or AA violations in the task list and its dialogs", async ({
    page,
  }) => {
    const data = await fixture(page);
    await openTasks(page, data);
    await accessible(page);
    await page
      .getByRole("button", { name: "Filter tasks", exact: true })
      .click();
    await accessible(page);
    await page
      .getByRole("button", { name: "Close Filter tasks", exact: true })
      .click();
    await page
      .getByRole("button", { name: "View settings", exact: true })
      .click();
    await accessible(page);
  });
});

test.describe("global task experience on a narrow screen", () => {
  test.use({
    viewport: { width: 390, height: 844 },
    isMobile: true,
    hasTouch: true,
    colorScheme: "light",
  });

  test("keeps primary actions, filters, details and creation usable without horizontal overflow", async ({
    page,
  }, info) => {
    await page.route("**/api/**", (route) => route.abort());
    const data = await fixture(page);
    await openTasks(page, data);
    for (const name of ["New task", "Filter tasks", "View settings"]) {
      await touchTarget(page.getByRole("button", { name, exact: true }));
    }
    await noOverflow(page);
    const fullyVisible = await page.locator(".task-row").evaluateAll(
      (elements) =>
        elements.filter((element) => {
          const box = element.getBoundingClientRect();
          return box.top >= 0 && box.bottom <= innerHeight;
        }).length,
    );
    const mobileGeometry = await page
      .locator(".task-row")
      .evaluateAll((elements) =>
        elements.slice(0, 4).map((element) => {
          const box = element.getBoundingClientRect();
          return { top: box.top, bottom: box.bottom, height: box.height };
        }),
      );
    expect(fullyVisible, JSON.stringify(mobileGeometry)).toBeGreaterThanOrEqual(
      3,
    );
    await page.screenshot({ path: info.outputPath("tasks-mobile.png") });

    await page.getByRole("button", { name: "Filter tasks", exact: true }).tap();
    const filters = page.getByRole("dialog", {
      name: "Filter tasks",
      exact: true,
    });
    await expect(
      filters.getByLabel("Filter task project", { exact: true }),
    ).toHaveValue(data.projectId);
    await noOverflow(page);
    await filters
      .getByRole("button", { name: "Close Filter tasks", exact: true })
      .tap();

    await page
      .getByRole("button", { name: "View settings", exact: true })
      .tap();
    const settings = page.getByRole("dialog", {
      name: "View settings",
      exact: true,
    });
    await expect(
      settings.getByLabel("Group tasks", { exact: true }),
    ).toBeVisible();
    await noOverflow(page);
    await settings
      .getByRole("button", { name: "Close View settings", exact: true })
      .tap();

    const title = page.locator(`#task-${data.taskId}`).getByRole("button", {
      name: `Edit title for ${data.title}`,
      exact: true,
    });
    await title.scrollIntoViewIfNeeded();
    await touchTarget(title);
    await title.tap();
    const inlineTitle = page
      .locator(`#task-${data.taskId}`)
      .getByRole("textbox", { name: "Task title", exact: true });
    await expect(inlineTitle).toBeVisible();
    await expect(page.locator("dialog[open]")).toHaveCount(0);
    await page
      .locator(`#task-${data.taskId}`)
      .getByRole("button", { name: "Cancel", exact: true })
      .tap();
    const trigger = await openListDetails(page, data);
    const details = page.getByRole("dialog", {
      name: "Task details",
      exact: true,
    });
    await expect(details).toBeVisible();
    await noOverflow(page);
    await page.screenshot({ path: info.outputPath("task-detail-mobile.png") });
    await details
      .getByRole("button", { name: "Close Task details", exact: true })
      .tap();
    await expect(trigger).toBeFocused();

    await page.getByRole("button", { name: "New task", exact: true }).tap();
    const creation = page.getByRole("dialog", {
      name: "New task",
      exact: true,
    });
    await expect(creation).toBeVisible();
    await expect(
      creation.getByRole("textbox", { name: "Task title", exact: true }),
    ).toBeVisible();
    await noOverflow(page);
    await creation
      .getByRole("button", { name: "Close New task", exact: true })
      .tap();
    await expect(page.locator(".task-row")).toHaveCount(12);
  });

  test("has no WCAG A or AA violations on the mobile list, detail and creation form", async ({
    page,
  }) => {
    await page.route("**/api/**", (route) => route.abort());
    const data = await fixture(page);
    await openTasks(page, data);
    await accessible(page);
    await openListDetails(page, data);
    await accessible(page);
    await page
      .getByRole("button", { name: "Close Task details", exact: true })
      .click();
    await page.getByRole("button", { name: "New task", exact: true }).click();
    await accessible(page);
  });
});
