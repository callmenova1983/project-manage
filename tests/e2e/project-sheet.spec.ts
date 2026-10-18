import { test, expect, type Locator, type Page } from "@playwright/test";
async function openSheet(page: Page) {
  await page.addInitScript(() => {
    localStorage.setItem("project-manage-locale", "zh-CN");
    localStorage.setItem("project-manage-theme", "light");
    localStorage.setItem("project-manage-accent", "teal");
  });
  await page.goto("/demo/projects");
  await page.getByRole("button", { name: /批量(补齐|编辑)信息/ }).click();
  const dialog = page.getByRole("dialog", { name: "项目信息", exact: true });
  await dialog.getByRole("button", { name: /^全部项目/ }).click();
  return dialog;
}
const cell = (dialog: Locator, row: number, col: number) =>
  dialog.locator(`[data-row-id="project-${row}"][data-col="${col}"]`);
async function paste(target: Locator, text: string) {
  await target.evaluate((el, value) => {
    const clipboardData = new DataTransfer();
    clipboardData.setData("text/plain", value);
    el.dispatchEvent(
      new ClipboardEvent("paste", {
        bubbles: true,
        cancelable: true,
        clipboardData,
      }),
    );
  }, text);
}

test("compact cells edit in place, navigate and keep focus inside the sheet", async ({
  page,
}) => {
  const dialog = await openSheet(page);
  await expect(
    dialog.locator('tbody input:not([type="checkbox"])'),
  ).toHaveCount(0);
  const before = await dialog.locator("tbody tr").first().boundingBox();
  expect(before!.height).toBeLessThanOrEqual(38);
  await cell(dialog, 1, 2).click();
  const input = dialog.getByRole("textbox", {
    name: "Atlas Customer Portal客户",
  });
  await input.fill("客户甲");
  await input.press("Tab");
  await expect(cell(dialog, 1, 2)).toContainText("客户甲");
  await expect(cell(dialog, 2, 0)).toBeFocused();
  await cell(dialog, 2, 0).press("ArrowRight");
  await cell(dialog, 2, 1).press("Enter");
  await expect(
    dialog.getByRole("combobox", { name: "Meridian Workspace阶段" }),
  ).toBeFocused();
  await dialog
    .getByRole("combobox", { name: "Meridian Workspace阶段" })
    .press("Escape");
  await expect(dialog).toBeVisible();
  await expect(cell(dialog, 2, 1)).toBeFocused();
  const after = await dialog.locator("tbody tr").first().boundingBox();
  expect(after!.height).toBe(before!.height);
  const save = dialog.getByRole("button", { name: "保存 1 个项目" });
  await save.focus();
  await save.press("Tab");
  await expect(
    dialog.getByRole("button", { name: "关闭项目信息" }),
  ).toBeFocused();
  await page.screenshot({ path: "data/sheet-desktop-light.png" });
});

test("pastes a rectangular Excel range, rejects invalid stages and saves only metadata", async ({
  page,
}) => {
  const dialog = await openSheet(page);
  const original = await page.evaluate(() =>
    JSON.parse(localStorage.getItem("project-manage-demo-v1")!).projects.slice(
      0,
      2,
    ),
  );
  await cell(dialog, 1, 0).click();
  await paste(
    cell(dialog, 1, 0),
    "郑元杰\t实施中\t客户甲\r\n李峰\t方案与报价\t客户乙\r\n",
  );
  await expect(cell(dialog, 1, 0)).toContainText("郑元杰");
  await expect(cell(dialog, 2, 2)).toContainText("客户乙");
  await expect(
    dialog.getByRole("button", { name: "保存 2 个项目" }),
  ).toBeEnabled();
  await dialog.getByRole("button", { name: "撤销", exact: true }).click();
  await expect(cell(dialog, 1, 0)).toContainText("Alex Morgan");
  await dialog.getByRole("button", { name: "重做", exact: true }).click();
  await expect(cell(dialog, 1, 0)).toContainText("郑元杰");
  await cell(dialog, 1, 0).click();
  await paste(cell(dialog, 1, 0), "张三\t实施中\t甲\n李四\t未知阶段\t乙");
  await expect(dialog.getByRole("alert")).toContainText("未知阶段");
  await dialog
    .getByRole("combobox", { name: "Atlas Customer Portal负责人" })
    .press("Escape");
  await expect(cell(dialog, 1, 0)).toContainText("郑元杰");
  await cell(dialog, 1, 2).click();
  await dialog
    .getByRole("textbox", { name: "Atlas Customer Portal客户" })
    .press("Escape");
  await cell(dialog, 2, 2).click({ modifiers: ["Shift"] });
  await cell(dialog, 2, 2).press("Control+d");
  await expect(cell(dialog, 2, 2)).toContainText("客户甲");
  await dialog.getByRole("button", { name: "保存 2 个项目" }).click();
  await expect(dialog).toBeHidden();
  const after = await page.evaluate(() =>
    JSON.parse(localStorage.getItem("project-manage-demo-v1")!).projects.slice(
      0,
      2,
    ),
  );
  expect(after[0]).toMatchObject({
    owner: "郑元杰",
    stage: "implementation",
    client: "客户甲",
  });
  expect(after[1]).toMatchObject({
    owner: "李峰",
    stage: "proposal",
    client: "客户甲",
  });
  for (let i = 0; i < 2; i++)
    for (const field of [
      "name",
      "latestUpdate",
      "notes",
      "reportedAt",
      "reportedBy",
    ])
      expect(after[i][field]).toEqual(original[i][field]);
  await page.reload();
  await page.getByRole("button", { name: /批量(补齐|编辑)信息/ }).click();
  await page
    .getByRole("dialog")
    .getByRole("button", { name: /^全部项目/ })
    .click();
  await expect(cell(page.getByRole("dialog"), 1, 0)).toContainText("郑元杰");
});

test("completed information leaves the completion list after saving and remains editable", async ({
  page,
}) => {
  const dialog = await openSheet(page);
  // All seeded projects have an owner and stage. Optional clients do not block completion.
  await dialog.getByRole("button", { name: /^待补全 0$/ }).click();
  await expect(
    dialog.getByText("项目信息已补齐，可在“全部项目”继续编辑。"),
  ).toBeVisible();
  await dialog.getByRole("button", { name: "关闭项目信息" }).click();
  await page.evaluate(() => {
    const key = "project-manage-demo-v1";
    const data = JSON.parse(localStorage.getItem(key)!);
    data.projects[0].owner = "";
    data.projects[0].stage = "unclassified";
    data.projects[0].client = "";
    localStorage.setItem(key, JSON.stringify(data));
  });
  await page.reload();
  await page.getByRole("button", { name: "批量补齐信息", exact: true }).click();
  await expect(dialog.locator("tbody tr")).toHaveCount(1);
  await expect(cell(dialog, 2, 0)).toHaveCount(0);
  await cell(dialog, 1, 0).click();
  await paste(cell(dialog, 1, 0), "王鑫\t实施中\t");
  // Do not remove the focused row while its changes are still unsaved.
  await expect(cell(dialog, 1, 0)).toContainText("王鑫");
  await dialog.getByRole("button", { name: "保存 1 个项目" }).click();
  await expect(dialog).toBeHidden();
  await page.getByRole("button", { name: "批量编辑信息", exact: true }).click();
  await expect(
    dialog.getByRole("button", { name: /^待补全 0$/ }),
  ).toHaveAttribute("aria-pressed", "true");
  await expect(cell(dialog, 1, 0)).toHaveCount(0);
  await dialog.getByRole("button", { name: /^全部项目/ }).click();
  await expect(cell(dialog, 1, 0)).toContainText("王鑫");
  await expect(cell(dialog, 1, 1)).toContainText("实施中");
});

test("person search floats over the grid and bulk filling stays secondary", async ({
  page,
}) => {
  const dialog = await openSheet(page);
  await expect(
    dialog.getByRole("combobox", { name: "统一负责人" }),
  ).toHaveCount(0);
  await cell(dialog, 1, 0).click();
  const rowBefore = await dialog.locator("tbody tr").first().boundingBox();
  const picker = dialog.getByRole("combobox", {
    name: "Atlas Customer Portal负责人",
  });
  await picker.fill("Alex");
  await expect(
    page.getByRole("listbox", { name: "Atlas Customer Portal负责人" }),
  ).toBeVisible();
  expect(
    (await dialog.locator("tbody tr").first().boundingBox())!.height,
  ).toEqual(rowBefore!.height);
  await picker.press("Enter");
  await expect(cell(dialog, 2, 0)).toBeFocused();
  await dialog.getByRole("button", { name: "统一填入", exact: true }).click();
  await expect(
    dialog.getByRole("combobox", { name: "统一负责人" }),
  ).toBeVisible();
  await dialog.getByRole("button", { name: "统一填入", exact: true }).click();
  await page.evaluate(() =>
    document.documentElement.setAttribute("data-theme", "dark"),
  );
  await page.screenshot({ path: "data/sheet-desktop-dark.png" });
});

test("mobile keeps a bounded sheet with horizontal scrolling", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const dialog = await openSheet(page);
  expect((await dialog.boundingBox())!.width).toBeLessThanOrEqual(390);
  const scroll = dialog.locator(".sheet-scroll");
  expect(await scroll.evaluate((el) => el.scrollWidth > el.clientWidth)).toBe(
    true,
  );
  await scroll.evaluate((el) => (el.scrollLeft = el.scrollWidth));
  await cell(dialog, 1, 2).click();
  await dialog
    .getByRole("textbox", { name: "Atlas Customer Portal客户" })
    .fill("移动端客户");
  await dialog
    .getByRole("textbox", { name: "Atlas Customer Portal客户" })
    .press("Enter");
  await expect(cell(dialog, 2, 2)).toBeFocused();
  await page.screenshot({ path: "data/sheet-mobile.png" });
});
