import { test, expect } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { randomUUID } from "node:crypto";
import { mkdirSync } from "node:fs";
import { scenarioLogin } from "./scenario-login";
import { Repository } from "../../apps/api/src/database";
import { defaultModelSettings } from "../../packages/domain/admin";
import { projectInput } from "../../packages/domain/types";

for (const width of [1536, 390]) {
  test(`complete weekly history and stable detail pagination at ${width}px`, async ({
    page,
  }) => {
    test.setTimeout(90000);
    await page.setViewportSize({ width, height: width === 390 ? 844 : 1024 });
    const errors: string[] = [];
    page.on("pageerror", (e) => errors.push(e.message));
    page.on("console", (m) => {
      if (m.type() === "error") errors.push(m.text());
    });
    const { actor } = await scenarioLogin(page, "data/e2e-login.json");
    const repo = new Repository("data/e2e.sqlite"),
      prefix = `history-${randomUUID()}`;
    const base = repo.snapshot(actor.workspaceId).projects[0]!;
    try {
      repo.transaction(() => {
        for (let i = 0; i < 620; i++)
          repo.audit(actor.workspaceId, {
            id: `${prefix}-${String(i).padStart(4, "0")}`,
            projectId: base.id,
            entityId: base.id,
            kind: "project",
            action: "Updated project",
            actor: "Synthetic history member",
            createdAt: "2020-10-07T12:00:00.000Z",
            source: `${prefix} Historical evidence ${i}`,
            before: base,
            after: {
              ...base,
              latestUpdate: `Historical evidence ${i}`,
              version: base.version + 1,
            },
          });
        for (let i = 0; i < 520; i++)
          repo.audit(actor.workspaceId, {
            id: `${prefix}-later-${i}`,
            projectId: base.id,
            entityId: base.id,
            kind: "project",
            action: "Updated project",
            actor: "Synthetic history member",
            createdAt: "2021-01-01T12:00:00.000Z",
            source: prefix,
            before: base,
            after: base,
          });
      });
      await page.goto("/projects");
      await page
        .getByRole("button", { name: "Changes & next work", exact: true })
        .click();
      await page.getByLabel("Week starting (UTC)").fill("2020-10-05");
      await page.getByLabel("Week starting (UTC)").blur();
      await expect(page.locator(".change-metrics strong").first()).toHaveText(
        "620",
      );
      await expect(page.locator(".change-timeline li")).toHaveCount(7);
      await page
        .getByRole("button", { name: "Load more changes", exact: true })
        .click();
      await expect(page.locator(".change-timeline li")).toHaveCount(14);
      mkdirSync("artifacts/history-members", { recursive: true });
      await page
        .locator(".weekly-changes")
        .screenshot({ path: `artifacts/history-members/weekly-${width}.png` });
      await page.getByRole("link", { name: "History", exact: true }).click();
      await expect(page.getByLabel("Week starting (UTC)")).toHaveValue(
        "2020-10-05",
      );
      await expect(page.locator(".activity-event")).toHaveCount(25);
      await expect(page.locator(".list-footnote").last()).toContainText(
        "25 of 620",
      );
      await page
        .getByRole("button", { name: "Load more changes", exact: true })
        .dblclick();
      await expect(page.locator(".activity-event")).toHaveCount(50);
      expect(
        new Set(
          await page
            .locator(".activity-event")
            .evaluateAll((nodes) => nodes.map((n) => n.id)),
        ).size,
      ).toBe(50);
      await page.getByLabel("Search activity").fill("Historical evidence 619");
      await expect(page.locator(".activity-event")).toHaveCount(1);
      await expect(page.locator(".activity-event")).toContainText(
        "Historical evidence 619",
      );
      await page.getByRole("button", { name: "Refresh history" }).click();
      await expect(page.locator(".activity-event")).toHaveCount(1);
      await page.getByLabel("Search activity").fill("");
      await expect(page.locator(".activity-event")).toHaveCount(25);
      mkdirSync("artifacts/history-members", { recursive: true });
      await page.screenshot({
        path: `artifacts/history-members/history-${width}.png`,
        fullPage: false,
      });
      expect(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth + 1,
        ),
      ).toBe(true);
      await page.goto(`/activity?project=${base.id}#activity-${prefix}-0619`);
      await expect(page.locator(`#activity-${prefix}-0619`)).toContainText(
        "Historical evidence 619",
      );
      await page.getByLabel("Week starting (UTC)").fill("2010-01-04");
      await page.getByLabel("Week starting (UTC)").blur();
      await expect(
        page.getByRole("heading", { name: "No activity found" }),
      ).toBeVisible();
      expect(errors).toEqual([]);
    } finally {
      repo.db
        .prepare("DELETE FROM activities WHERE workspace_id=? AND id LIKE ?")
        .run(actor.workspaceId, prefix + "%");
      repo.close();
    }
  });

  test(`member identity, rename, disabled retention and cancel at ${width}px in isolated demo`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: width === 390 ? 844 : 1024 });
    const calls: string[] = [],
      errors: string[] = [];
    page.on("request", (r) => {
      if (r.url().includes("/api/")) calls.push(r.url());
    });
    page.on("pageerror", (e) => errors.push(e.message));
    page.on("console", (m) => {
      if (m.type() === "error") errors.push(m.text());
    });
    await page.goto("/demo/");
    await page
      .getByRole("heading", { name: "Projects 20", exact: true })
      .waitFor();
    await page.evaluate((model) => {
      const data = JSON.parse(localStorage.getItem("project-manage-demo-v1")!);
      data.administration = {
        users: [
          {
            id: "local-demo",
            name: "Local demo",
            email: "demo@example.test",
            role: "admin",
            status: "active",
            version: 1,
            activationRequired: false,
          },
          ...["a", "b"].map((id) => ({
            id: `member-${id}`,
            name: "Same Person",
            email: `person-${id}@example.test`,
            role: "member",
            status: "active",
            version: 1,
            activationRequired: false,
          })),
        ],
        model,
        logs: [],
        audit: [],
      };
      localStorage.setItem("project-manage-demo-v1", JSON.stringify(data));
    }, defaultModelSettings);
    await page.reload();
    await page
      .getByRole("button", {
        name: "Expand Atlas Customer Portal",
        exact: true,
      })
      .click();
    await page
      .getByRole("button", { name: "Edit project", exact: true })
      .click();
    await page
      .locator(".member-link-options summary")
      .filter({ hasText: "Owner member" })
      .click();
    await page
      .getByLabel("Owner member", { exact: true })
      .selectOption("member-a");
    await page
      .getByRole("group", { name: "Project participants" })
      .getByLabel("Same Person · person-b@example.test")
      .check();
    await page
      .getByRole("button", { name: "Save project", exact: true })
      .click();
    await expect(page.getByLabel("Project editor")).toHaveCount(0);
    await page.getByRole("button", { name: "Add task", exact: true }).click();
    await page
      .getByLabel("Task title", { exact: true })
      .fill("Identity-linked synthetic task");
    await page.getByRole("button", { name: "More", exact: true }).click();
    await page
      .locator(".member-link-options summary")
      .filter({ hasText: "Assignee member" })
      .click();
    await page
      .getByLabel("Assignee member", { exact: true })
      .selectOption("member-b");
    await page.getByRole("button", { name: "Save task", exact: true }).click();
    await page.goto("/demo/admin");
    const row = page
      .locator(".admin-user")
      .filter({ hasText: "person-b@example.test" });
    await row.getByRole("button", { name: /Edit/ }).click();
    await page.getByLabel("Name", { exact: true }).fill("Renamed Member");
    await page.getByLabel("Account status").selectOption("disabled");
    await page.getByRole("button", { name: "Save user", exact: true }).click();
    await expect(row).toContainText("Renamed Member");
    await page.goto("/demo/projects/project-1");
    await expect(
      page
        .locator(".task-row")
        .filter({ hasText: "Identity-linked synthetic task" }),
    ).toContainText("Renamed Member");
    await expect(
      page.getByText("Project participants: Renamed Member", { exact: false }),
    ).toBeVisible();
    await page
      .getByRole("button", { name: "Edit project", exact: true })
      .click();
    await expect(page.getByLabel("Owner member", { exact: true })).toHaveValue(
      "member-a",
    );
    await expect(
      page.getByRole("group", { name: "Project participants" }),
    ).toContainText("disabled");
    await page
      .locator(".member-link-options summary")
      .filter({ hasText: "Owner member" })
      .click();
    await page
      .getByLabel("Owner member", { exact: true })
      .selectOption("__unassigned");
    page.once("dialog", (dialog) => dialog.accept());
    await page.getByRole("button", { name: "Cancel", exact: true }).click();
    await page
      .getByRole("button", { name: "Edit project", exact: true })
      .click();
    await expect(page.getByLabel("Owner member", { exact: true })).toHaveValue(
      "member-a",
    );
    await page
      .getByLabel("Description", { exact: true })
      .fill("Retained participant after account disable");
    await page
      .getByRole("button", { name: "Save project", exact: true })
      .click();
    await page.reload();
    await page
      .getByRole("button", { name: "Edit project", exact: true })
      .click();
    await expect(
      page
        .getByRole("group", { name: "Project participants" })
        .getByRole("checkbox"),
    ).toHaveCount(3);
    expect(
      (
        await new AxeBuilder({ page })
          .withTags(["wcag2a", "wcag2aa", "wcag21aa"])
          .analyze()
      ).violations,
    ).toEqual([]);
    mkdirSync("artifacts/history-members", { recursive: true });
    await page.screenshot({
      path: `artifacts/history-members/members-${width}.png`,
      fullPage: true,
    });
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth + 1,
      ),
    ).toBe(true);
    const snapshot = await page.evaluate(() =>
      JSON.parse(localStorage.getItem("project-manage-demo-v1")!),
    );
    expect(
      projectInput
        .strip()
        .parse(
          snapshot.projects.find((p: { id: string }) => p.id === "project-1"),
        ),
    ).toMatchObject({ ownerId: "member-a", participantIds: ["member-b"] });
    expect(calls).toEqual([]);
    expect(errors).toEqual([]);
  });
}
