import { scenarioLogin } from "./scenario-login";
import { test, expect } from "@playwright/test";
import { readFileSync, mkdirSync } from "node:fs";
import { randomUUID } from "node:crypto";
import AxeBuilder from "@axe-core/playwright";
import { Repository } from "../../apps/api/src/database";
import type { ActivityPage } from "../../packages/domain/activity-query";
for (const width of [1536, 390]) {
  test(`shared timezone, weekly boundary, stable history export at ${width}px`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: width === 390 ? 844 : 1024 });
    const errors: string[] = [];
    page.on("pageerror", (e) => errors.push(e.message));
    page.on("console", (m) => {
      if (m.type() === "error") errors.push(m.text());
    });
    test.setTimeout(90000);
    const { actor, csrf } = await scenarioLogin(
      page,
      "data/e2e-admin-login.json",
    );
    const repo = new Repository("data/e2e.sqlite"),
      prefix = `tz-${randomUUID()}`;
    const original = repo.settings(actor.workspaceId);
    const base = repo.snapshot(actor.workspaceId).projects[0]!;
    const record = (id: string, at: string) =>
      repo.audit(actor.workspaceId, {
        id: prefix + id,
        projectId: base.id,
        entityId: base.id,
        kind: "project",
        action: "Updated project",
        actor: "Synthetic calendar reviewer",
        createdAt: at,
        source: prefix,
        before: base,
        after: {
          ...base,
          latestUpdate: "Synthetic Beijing weekly boundary",
          version: base.version + 1,
        },
      });
    try {
      repo.transaction(() => {
        record("before", "2020-10-04T15:59:59.999Z");
        for (let i = 0; i < 31; i++)
          record(String(i).padStart(2, "0"), "2020-10-04T16:00:00.000Z");
        record("next", "2020-10-11T16:00:00Z");
      });
      await page.goto("/settings");
      await expect(
        page.getByLabel("IANA time zone", { exact: true }),
      ).toHaveValue("UTC");
      await page
        .getByLabel("IANA time zone", { exact: true })
        .fill("Asia/Shanghai");
      await expect(
        page.getByRole("button", { name: "Save time zone", exact: true }),
      ).toBeDisabled();
      await page
        .getByRole("button", { name: "Cancel time zone change", exact: true })
        .click();
      await expect(
        page.getByLabel("IANA time zone", { exact: true }),
      ).toHaveValue("UTC");
      await page
        .getByLabel("IANA time zone", { exact: true })
        .fill("Asia/Shanghai");
      await page
        .getByLabel(
          "I confirm changing the shared calendar for everyone in this workspace",
        )
        .check();
      await page
        .getByRole("button", { name: "Save time zone", exact: true })
        .click();
      await expect(
        page.getByText("Current time zone: Asia/Shanghai", { exact: true }),
      ).toBeVisible();
      await page.reload();
      await expect(
        page.getByLabel("IANA time zone", { exact: true }),
      ).toHaveValue("Asia/Shanghai");
      mkdirSync("artifacts/time-zone", { recursive: true });
      await page.screenshot({
        path: `artifacts/time-zone/settings-${width}.png`,
      });
      expect(
        (
          await new AxeBuilder({ page })
            .withTags(["wcag2a", "wcag2aa", "wcag21aa"])
            .analyze()
        ).violations,
      ).toEqual([]);
      await page.goto("/projects");
      await page
        .getByRole("button", { name: "Changes & next work", exact: true })
        .click();
      await page.getByLabel("Week starting (Asia/Shanghai)").fill("2020-10-05");
      await page.getByLabel("Week starting (Asia/Shanghai)").blur();
      await expect(page.locator(".change-metrics strong").first()).toHaveText(
        "31",
      );
      await page
        .locator(".weekly-changes")
        .screenshot({ path: `artifacts/time-zone/weekly-${width}.png` });
      await page.getByRole("link", { name: "History", exact: true }).click();
      await page.getByLabel("Search activity").fill(prefix);
      await expect(page.locator(".activity-event")).toHaveCount(25);
      await page
        .getByRole("button", { name: "Load more changes", exact: true })
        .dblclick();
      await expect(page.locator(".activity-event")).toHaveCount(31);
      record("late", "2020-10-06T00:00:00Z");
      const downloadPromise = page.waitForEvent("download");
      await page
        .getByRole("button", { name: "Export filtered history", exact: true })
        .click();
      const download = await downloadPromise;
      const history = JSON.parse(
        readFileSync((await download.path())!, "utf8"),
      ) as ActivityPage;
      expect(history.total).toBe(31);
      expect(history.events).toHaveLength(31);
      expect(history.timeZone).toBe("Asia/Shanghai");
      expect(history.days.map((d) => d.count)).toEqual([31, 0, 0, 0, 0, 0, 0]);
      expect(history.bounds?.start).toBe("2020-10-04T16:00:00.000Z");
      expect(history.events.some((a) => a.id.endsWith("late"))).toBe(false);
      await page.evaluate(() => window.scrollTo(0, 0));
      await page.screenshot({
        path: `artifacts/time-zone/history-${width}.png`,
      });
      await expect(page.locator(".list-footnote").last()).toContainText(
        "31 of 31",
      );
      expect(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth + 1,
        ),
      ).toBe(true);
      expect(errors).toEqual([]);
    } finally {
      const current = repo.settings(actor.workspaceId);
      const reset = await page.request.put("/api/admin/workspace-settings", {
        headers: { "x-csrf-token": csrf, "idempotency-key": randomUUID() },
        data: {
          timeZone: original.timeZone,
          version: current.version,
          confirmed: true,
        },
      });
      expect(
        reset.ok(),
        `Timezone cleanup returned HTTP ${reset.status()}`,
      ).toBe(true);
      repo.db
        .prepare("DELETE FROM activities WHERE workspace_id=? AND id LIKE ?")
        .run(actor.workspaceId, prefix + "%");
      repo.close();
    }
  });
}
test("members can read timezone but cannot edit the shared setting", async ({
  page,
}) => {
  test.setTimeout(90000);
  await scenarioLogin(page, "data/e2e-login.json");
  await page.goto("/settings");
  await expect(
    page.getByText("Current time zone: UTC", { exact: true }),
  ).toBeVisible();
  await expect(
    page.getByText("An administrator can change the workspace time zone."),
  ).toBeVisible();
  await expect(page.getByLabel("IANA time zone", { exact: true })).toHaveCount(
    0,
  );
});
test("local timezone preserves a dirty draft on conflict, reloads explicitly and cancels route departure", async ({
  page,
}) => {
  await page.goto("/demo/settings");
  await page
    .getByLabel("IANA time zone", { exact: true })
    .fill("Asia/Shanghai");
  await page
    .getByRole("button", { name: "Toggle sidebar", exact: true })
    .click();
  page.once("dialog", (d) => d.dismiss());
  await page
    .getByRole("navigation", { name: "Main navigation", exact: true })
    .getByRole("link", { name: "Projects", exact: true })
    .click();
  await expect(page).toHaveURL(/\/demo\/settings$/);
  await page
    .getByRole("button", { name: "Close sidebar", exact: true })
    .click();
  await expect(page.getByLabel("IANA time zone", { exact: true })).toHaveValue(
    "Asia/Shanghai",
  );
  await page.evaluate(() => {
    const data = JSON.parse(localStorage.getItem("project-manage-demo-v1")!);
    data.settings = { timeZone: "Europe/London", version: 2 };
    data.revision++;
    localStorage.setItem("project-manage-demo-v1", JSON.stringify(data));
  });
  await page
    .getByLabel(
      "I confirm changing the shared calendar for everyone in this workspace",
    )
    .check();
  await page
    .getByRole("button", { name: "Save time zone", exact: true })
    .click();
  await expect(page.getByRole("alert")).toContainText(
    "Workspace settings changed",
  );
  await expect(page.getByLabel("IANA time zone", { exact: true })).toHaveValue(
    "Asia/Shanghai",
  );
  await page
    .getByRole("button", { name: "Reload current settings", exact: true })
    .click();
  await expect(page.getByLabel("IANA time zone", { exact: true })).toHaveValue(
    "Europe/London",
  );
  await page
    .getByLabel("IANA time zone", { exact: true })
    .fill("Asia/Shanghai");
  await page
    .getByLabel(
      "I confirm changing the shared calendar for everyone in this workspace",
    )
    .check();
  await page
    .getByRole("button", { name: "Save time zone", exact: true })
    .click();
  await expect(
    page.getByText("Current time zone: Asia/Shanghai", { exact: true }),
  ).toBeVisible();
  await page.reload();
  await expect(page.getByLabel("IANA time zone", { exact: true })).toHaveValue(
    "Asia/Shanghai",
  );
});
