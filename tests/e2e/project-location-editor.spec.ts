import { test, expect, type Page } from "@playwright/test";
import type { WorkspaceApi } from "../../apps/web/src/services/contracts";

async function readProject(page: Page, name: string) {
  return page.evaluate(async (projectName) => {
    const modulePath = "/src/services/local.ts";
    const { createLocalApi } = (await import(modulePath)) as {
      createLocalApi: () => WorkspaceApi;
    };
    return (await createLocalApi().snapshot()).projects.find(
      (project) => project.name === projectName,
    );
  }, name);
}

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem("project-manage-locale", "zh-CN");
    localStorage.setItem("project-manage-theme", "light");
  });
});

test("prefers a district, retains it on unrelated edits and rejects unresolved replacement text", async ({
  page,
}) => {
  await page.goto("/demo/projects");
  await page.getByRole("button", { name: "新建项目", exact: true }).click();
  const form = page.getByRole("form", { name: "项目编辑器" });
  await form.getByLabel("项目名称", { exact: true }).fill("城市编辑入口回归");
  const city = form.getByLabel("地址 / 城市 / 区县", { exact: true });
  await city.fill("浙江省宁波市北仑区测试路123号");
  await expect(form).toContainText("已识别位置");
  await expect(form).toContainText("区县中心");
  await form.getByRole("button", { name: "保存项目", exact: true }).click();
  await expect(form).toBeHidden();
  const saved = (await readProject(page, "城市编辑入口回归"))!;
  expect(saved.location).toMatchObject({
    cityId: "ningbo",
    confirmed: true,
    precision: "district",
    district: "北仑区",
  });
  expect(JSON.stringify(saved.location)).not.toContain("123号");

  await page.goto(`/demo/projects/${saved.id}`);
  await page.getByRole("button", { name: "项目详情", exact: true }).click();
  let detail = page.getByRole("dialog", { name: "项目详情", exact: true });
  await expect(detail).toContainText("位置已确认");
  await expect(detail).toContainText("北仑区");
  await expect(detail).toContainText("区县中心");
  await expect(
    detail.getByRole("link", { name: "在项目地图中查看" }),
  ).toHaveAttribute("href", `/demo/project-map?project=${saved.id}`);
  await detail.getByRole("button", { name: "修改项目位置" }).click();
  await form.getByLabel("客户 / 组织", { exact: true }).fill("只改客户");
  await form.getByRole("button", { name: "保存项目", exact: true }).click();
  await expect(form).toBeHidden();
  expect((await readProject(page, saved.name))?.location).toEqual(
    saved.location,
  );

  await page.getByRole("button", { name: "项目详情", exact: true }).click();
  detail = page.getByRole("dialog", { name: "项目详情", exact: true });
  await detail.getByRole("button", { name: "修改项目位置" }).click();
  await city.fill("不明确的园区");
  await form.getByRole("button", { name: "保存项目", exact: true }).click();
  await expect(form).toContainText("请先选择支持的位置或输入经纬度再保存");
  await expect(city).toHaveValue("不明确的园区");
  expect((await readProject(page, saved.name))?.location).toEqual(
    saved.location,
  );
  await city.fill("上海 / 杭州");
  await expect(form).toContainText("匹配到多个位置");
  await form
    .getByRole("button", { name: "选择上海 · 城市中心", exact: true })
    .click();
  await form.getByRole("button", { name: "保存项目", exact: true }).click();
  await expect(form).toBeHidden();
  expect((await readProject(page, saved.name))?.location).toMatchObject({
    cityId: "shanghai",
    confirmed: true,
    precision: "city",
  });
});

test("supports county input and an explicit clear action on mobile", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/demo/projects");
  await page.getByRole("button", { name: "新建项目", exact: true }).click();
  const form = page.getByRole("form", { name: "项目编辑器" });
  await form.getByLabel("项目名称", { exact: true }).fill("县域城市编辑回归");
  await form.getByLabel("地址 / 城市 / 区县", { exact: true }).fill("云和县");
  await form
    .getByRole("button", { name: "选择丽水 · 云和县 · 区县中心", exact: true })
    .click();
  await form.getByRole("button", { name: "保存项目", exact: true }).click();
  await expect(form).toBeHidden();
  const saved = (await readProject(page, "县域城市编辑回归"))!;
  expect(saved.location).toMatchObject({
    cityId: "lishui",
    district: "云和县",
    precision: "district",
    confirmed: true,
  });
  await page.goto(`/demo/projects/${saved.id}`);
  await page.getByRole("button", { name: "项目详情", exact: true }).click();
  await page
    .getByRole("dialog", { name: "项目详情", exact: true })
    .getByRole("button", { name: "修改项目位置" })
    .click();
  await form.getByRole("button", { name: "清除定位", exact: true }).click();
  await expect(form).toContainText("未设置位置");
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth + 1,
    ),
  ).toBe(true);
  await form.getByRole("button", { name: "保存项目", exact: true }).click();
  await expect(form).toBeHidden();
  expect((await readProject(page, saved.name))?.location).toBeNull();
});

test("saves an explicit coordinate point without requiring a city candidate and preserves it after reload", async ({
  page,
}) => {
  await page.goto("/demo/projects");
  await page.getByRole("button", { name: "新建项目", exact: true }).click();
  const form = page.getByRole("form", { name: "项目编辑器" });
  await form.getByLabel("项目名称", { exact: true }).fill("精确坐标编辑回归");
  await form
    .getByLabel("地址 / 城市 / 区县", { exact: true })
    .fill("121.8, 29.9");
  await expect(form).toContainText("坐标点位");
  await expect(form.locator(".city-choices button")).toHaveCount(0);
  await form.getByRole("button", { name: "保存项目", exact: true }).click();
  await expect(form).toBeHidden();
  const saved = (await readProject(page, "精确坐标编辑回归"))!;
  expect(saved.location).toMatchObject({
    precision: "point",
    longitude: 121.8,
    latitude: 29.9,
    confirmed: true,
    coordinateSource: "user-coordinates",
  });
  await page.goto(`/demo/projects/${saved.id}`);
  await page.getByRole("button", { name: "项目详情", exact: true }).click();
  const detail = page.getByRole("dialog", { name: "项目详情", exact: true });
  await expect(detail).toContainText("坐标点位");
  await expect(detail).toContainText("精度取决于输入的坐标或点选位置");
  await expect(detail).toContainText("121.8");
  await expect(detail).toContainText("29.9");
  await detail.getByRole("button", { name: "修改项目位置" }).click();
  await expect(
    form.getByLabel("地址 / 城市 / 区县", { exact: true }),
  ).toHaveValue("121.8, 29.9");
  await form.getByLabel("客户 / 组织", { exact: true }).fill("保留坐标的客户");
  await form.getByRole("button", { name: "保存项目", exact: true }).click();
  await expect(form).toBeHidden();
  expect((await readProject(page, saved.name))?.location).toEqual(
    saved.location,
  );
});
