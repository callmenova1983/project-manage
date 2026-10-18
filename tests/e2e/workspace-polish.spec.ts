import { test, expect } from "@playwright/test";

for (const width of [1440, 390]) {
  test.describe(`workspace polish ${width}px`, () => {
    test.use({ viewport: { width, height: 1000 } });
    test("persists colors and edits source notes from reading mode", async ({
      page,
    }) => {
      const errors: string[] = [];
      page.on("pageerror", (e) => errors.push(e.message));
      await page.addInitScript(() =>
        localStorage.setItem("project-manage-locale", "en"),
      );
      await page.goto("/demo/projects/project-1");
      await expect(page.locator("html")).toHaveAttribute("data-accent", "blue");
      await page
        .getByRole("button", { name: "Theme color", exact: true })
        .click();
      await page.getByRole("button", { name: "Teal", exact: true }).click();
      await expect(page.locator("html")).toHaveAttribute("data-accent", "teal");
      await page.reload();
      await expect(page.locator("html")).toHaveAttribute("data-accent", "teal");
      await page.goto("/demo/projects");
      await page
        .getByRole("button", {
          name: "Add progress for Atlas Customer Portal",
          exact: true,
        })
        .click();
      const update = page.getByRole("form", {
        name: "Latest update editor",
        exact: true,
      });
      await expect(page.getByRole("dialog")).toHaveCount(0);
      await update
        .getByRole("textbox", { name: "Latest reported update", exact: true })
        .fill("New site progress\nCommissioning is underway");
      await update.getByRole("textbox").press("Control+Enter");
      await expect(update).toBeHidden();
      await expect(
        page.locator(".project-record").filter({
          has: page.getByRole("link", {
            name: "Atlas Customer Portal",
            exact: true,
          }),
        }),
      ).toContainText("Local demo");
      await page.goto("/demo/projects/project-1");
      await expect(page.locator(".update-card")).toContainText(
        "New site progress",
      );
      await page
        .getByRole("button", {
          name: "Add progress for Atlas Customer Portal",
          exact: true,
        })
        .click();
      await page
        .getByRole("form", { name: "Latest update editor" })
        .getByRole("textbox")
        .fill("Should not save");
      await page
        .getByRole("form", { name: "Latest update editor" })
        .getByRole("textbox")
        .press("Escape");
      await expect(page.locator(".update-card")).toContainText(
        "New site progress",
      );
      await page.locator("#progress-history summary").click();
      await expect(page.locator(".progress-timeline")).toContainText(
        "New site progress",
      );
      await page
        .getByRole("button", {
          name: "Add progress for Atlas Customer Portal",
          exact: true,
        })
        .click();
      const correction = page.getByRole("form", {
        name: "Latest update editor",
      });
      await correction
        .getByRole("button", { name: "Correct last entry", exact: true })
        .click();
      await correction.getByRole("textbox").fill("Corrected site progress");
      await correction.getByRole("textbox").press("Control+Enter");
      await expect(page.locator(".progress-timeline")).toContainText(
        "Corrected site progress",
      );
      await expect(page.locator(".progress-timeline")).toContainText(
        "New site progress",
      );
      const source = page.locator(".source-records");
      await expect(source).not.toHaveAttribute("open");
      await expect(source.locator("textarea")).toHaveCount(0);
      await source.locator("summary").click();
      await source
        .getByRole("button", { name: "Edit notes", exact: true })
        .click();
      const notes = source.getByRole("textbox", {
        name: "Original notes for Atlas Customer Portal",
      });
      const exact =
        "Source record\n" +
        "Long meeting paragraph with all details preserved. ".repeat(30);
      await notes.fill(exact);
      await source
        .getByRole("button", { name: "Save notes", exact: true })
        .click();
      await expect(source.locator("textarea")).toHaveCount(0);
      await expect(source.locator(".notes-reading")).toHaveText(exact);
      await expect(source.locator(".notes-reading")).toHaveJSProperty(
        "scrollWidth",
        await source.locator(".notes-reading").evaluate((e) => e.clientWidth),
      );
      await page.reload();
      await source.locator("summary").click();
      await expect(source.locator(".notes-reading")).toHaveText(exact);
      expect(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth,
        ),
      ).toBe(true);
      expect(errors).toEqual([]);
    });
  });
}

test("directory uses one header and saves people from an edit dialog", async ({
  page,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.addInitScript(() =>
    localStorage.setItem("project-manage-locale", "en"),
  );
  await page.goto("/demo/directory");
  await page
    .getByRole("button", { name: "Manage organization", exact: true })
    .click();
  const org = page.getByRole("dialog", {
    name: "Manage organization",
    exact: true,
  });
  await org
    .getByRole("textbox", { name: "New department name", exact: true })
    .fill("Engineering team");
  await org
    .getByRole("button", { name: "Add department", exact: true })
    .click();
  await org.getByRole("button", { name: "Save", exact: true }).click();
  await expect(org).toBeHidden();
  await page.getByRole("button", { name: "Add person", exact: true }).click();
  const person = page.getByRole("dialog", { name: "Add person", exact: true });
  await person
    .getByRole("textbox", { name: "Name", exact: true })
    .fill("Sample colleague");
  await person
    .getByRole("textbox", { name: "Employee number", exact: true })
    .fill("TEST001");
  await person
    .getByRole("textbox", { name: "Position", exact: true })
    .fill("Engineer");
  await person.getByRole("button", { name: "Save", exact: true }).click();
  await expect(person).toBeHidden();
  await expect(page.locator(".directory-data-table thead")).toHaveCount(1);
  await expect(page.locator(".directory-data-table tbody")).toContainText(
    "Sample colleague",
  );
  await page
    .getByRole("textbox", { name: "Search people", exact: true })
    .fill("TEST001");
  await expect(page.locator(".directory-data-table tbody tr")).toHaveCount(1);
  await page.locator(".directory-data-table tbody tr").dblclick();
  const edit = page.getByRole("dialog", { name: "Edit person", exact: true });
  await edit
    .getByRole("textbox", { name: "Name", exact: true })
    .fill("Updated colleague");
  await edit.getByRole("button", { name: "Save", exact: true }).click();
  await page.reload();
  await expect(page.locator(".directory-data-table tbody")).toContainText(
    "Updated colleague",
  );
  expect(errors).toEqual([]);
});

test("plans work directly in the project row, edits its title and keeps the selected scope", async ({
  page,
}) => {
  await page.addInitScript(() =>
    localStorage.setItem("project-manage-locale", "en"),
  );
  await page.goto("/demo/projects");
  const row = page.locator(".project-record").filter({
    has: page.getByRole("link", {
      name: "Atlas Customer Portal",
      exact: true,
    }),
  });
  await row
    .getByRole("button", {
      name: "Plan work for Atlas Customer Portal",
      exact: true,
    })
    .click();
  const add = row.getByRole("form", { name: "Quick add task", exact: true });
  await add
    .getByRole("textbox", { name: "Task title", exact: true })
    .fill("Planned field visit");
  await add.getByRole("textbox").press("Enter");
  await expect(add).toBeHidden();
  await row
    .getByRole("button", { name: "Planned field visit", exact: true })
    .click();
  await row
    .locator(".quick-task-field.editing")
    .getByRole("textbox", { name: "Task title", exact: true })
    .fill("Confirmed field visit");
  await row
    .locator(".quick-task-field.editing")
    .getByRole("textbox")
    .press("Enter");
  await expect(
    row.getByRole("button", { name: "Confirmed field visit", exact: true }),
  ).toBeVisible();
  await page.goto("/demo/projects/project-1");
  await expect(
    page.getByRole("button", { name: "Confirmed field visit", exact: true }),
  ).toBeVisible();
});

test("project row expansion prioritizes tasks and opens source records only on demand", async ({
  page,
}) => {
  await page.addInitScript(() =>
    localStorage.setItem("project-manage-locale", "en"),
  );
  await page.goto("/demo/projects");
  await page
    .getByRole("button", { name: "Expand Atlas Customer Portal", exact: true })
    .click();
  const expanded = page.locator(".project-record.expanded");
  await expect(expanded.locator(".task-list")).toBeVisible();
  await expect(expanded.locator(".inline-notes")).toHaveCount(0);
  await expanded
    .getByRole("link", { name: "View source records", exact: true })
    .click();
  await expect(page).toHaveURL(/#source-records$/);
  await expect(page.locator("#source-records")).toHaveAttribute("open");
  await expect(page.locator("#source-records .inline-notes")).toBeVisible();
});

test("generates login names for new accounts and allows an explicit correction", async ({
  page,
}) => {
  await page.addInitScript(() =>
    localStorage.setItem("project-manage-locale", "en"),
  );
  await page.goto("/demo/admin");
  await page.getByRole("button", { name: "Add user", exact: true }).click();
  await page.getByLabel("Name", { exact: true }).fill("郑元杰");
  await page.getByLabel("Email", { exact: true }).fill("zheng@example.test");
  await page.getByRole("button", { name: "Save user", exact: true }).click();
  const user = page
    .locator(".admin-user")
    .filter({ hasText: "zheng@example.test" });
  await expect(user).toContainText("zhengyj");
  await user
    .getByRole("button", { name: "Edit user 郑元杰", exact: true })
    .click();
  await page.getByLabel("Login name", { exact: true }).fill("zheng.yj");
  await page.getByRole("button", { name: "Save user", exact: true }).click();
  await page.reload();
  await expect(user).toContainText("zheng.yj");
});

test("assignee searches pinyin and recommends project participants, saving in one selection", async ({
  page,
}) => {
  await page.addInitScript(() =>
    localStorage.setItem("project-manage-locale", "en"),
  );
  await page.goto("/demo/projects/project-1");
  await page.evaluate(() => {
    const key = "project-manage-demo-v1",
      state = JSON.parse(localStorage.getItem(key)!);
    state.directory = {
      version: 1,
      companyName: "Synthetic company",
      departments: [],
      lastSyncedAt: null,
      employees: [
        {
          id: "zyj",
          name: "郑元杰",
          employeeNo: "TEST001",
          position: "General manager",
          departmentIds: [],
          email: "",
          wecomUserId: "",
          userId: null,
          source: "manual",
          active: true,
        },
      ],
    };
    localStorage.setItem(key, JSON.stringify(state));
  });
  await page.reload();
  const row = page.locator(".task-row").first();
  const original = row
    .locator(".quick-task-field")
    .filter({ has: page.getByRole("button", { name: /^Assignee:/ }) });
  await original.getByRole("button", { name: /^Assignee:/ }).click();
  const search = page.getByRole("combobox", { name: "Assignee", exact: true });
  await search.fill("ZYJ");
  await expect(page.getByRole("option", { name: /郑元杰/ })).toHaveCount(1);
  await search.press("Enter");
  await expect(
    row.getByRole("button", { name: "Assignee: 郑元杰", exact: true }),
  ).toBeVisible();
  await page.reload();
  await page
    .locator(".task-row")
    .first()
    .getByRole("button", { name: "Assignee: 郑元杰", exact: true })
    .click();
  await search.fill("zhengyuanjie");
  await expect(page.getByRole("option", { name: /郑元杰/ })).toContainText(
    "Already assigned in this project",
  );
  await expect(page.getByRole("option", { name: /郑元杰/ })).toHaveCount(1);
  await search.fill("TEST001");
  await expect(page.getByRole("option", { name: /郑元杰/ })).toHaveCount(1);
  await search.press("Escape");
  await expect(
    page.getByRole("combobox", { name: "Assignee", exact: true }),
  ).toHaveCount(0);
});

test("people suggestions float under the input without changing the project form height", async ({
  page,
}) => {
  await page.addInitScript(() =>
    localStorage.setItem("project-manage-locale", "en"),
  );
  await page.goto("/demo/projects");
  await expect(page.locator(".project-record").first()).toBeVisible();
  await page.evaluate(() => {
    const key = "project-manage-demo-v1",
      state = JSON.parse(localStorage.getItem(key)!);
    state.directory = {
      version: 1,
      companyName: "Synthetic company",
      departments: [],
      lastSyncedAt: null,
      employees: [
        {
          id: "zyj",
          name: "郑元杰",
          employeeNo: "TEST001",
          position: "General manager",
          departmentIds: [],
          email: "",
          wecomUserId: "",
          userId: null,
          source: "manual",
          active: true,
        },
      ],
    };
    localStorage.setItem(key, JSON.stringify(state));
  });
  await page.reload();
  await page.getByRole("button", { name: "New project", exact: true }).click();
  const editor = page.getByRole("form", {
      name: "Project editor",
      exact: true,
    }),
    owner = editor.getByRole("combobox", { name: "Owner", exact: true });
  const before = (await editor.boundingBox())!;
  const aliasesBefore = (await editor
    .getByLabel("Aliases, comma separated", { exact: true })
    .boundingBox())!;
  await expect(page.locator(".person-popover")).toHaveCount(0);
  await owner.click();
  await expect(page.locator(".person-popover")).toBeVisible();
  await expect(owner).toHaveAttribute("aria-expanded", "true");
  const after = (await editor.boundingBox())!,
    aliasesAfter = (await editor
      .getByLabel("Aliases, comma separated", { exact: true })
      .boundingBox())!;
  expect(Math.abs(after.height - before.height)).toBeLessThan(1);
  expect(Math.abs(aliasesAfter.y - aliasesBefore.y)).toBeLessThan(1);
  expect(
    await page
      .locator(".person-popover")
      .evaluate((e) => getComputedStyle(e).position),
  ).toBe("fixed");
  await owner.fill("ZYJ");
  await expect(page.getByRole("option", { name: /郑元杰/ })).toBeVisible();
  await editor
    .getByRole("heading", { name: "New project", exact: true })
    .click();
  await expect(page.locator(".person-popover")).toHaveCount(0);
  await owner.click();
  await page.getByRole("option", { name: /郑元杰/ }).click();
  await expect(owner).toHaveValue("郑元杰");
  await expect(page.locator(".person-popover")).toHaveCount(0);
  await owner.click();
  await owner.press("Escape");
  await expect(page.locator(".person-popover")).toHaveCount(0);
});
