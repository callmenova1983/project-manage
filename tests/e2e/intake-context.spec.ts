import { test, expect } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { mkdirSync } from "node:fs";
for (const width of [1536, 390]) {
  test(`multi-project text context and ambiguity review at ${width}px`, async ({
    page,
  }) => {
    test.setTimeout(45000);
    await page.setViewportSize({ width, height: width === 390 ? 844 : 1024 });
    const errors: string[] = [],
      calls: string[] = [];
    page.on("pageerror", (e) => errors.push(e.message));
    page.on("console", (m) => {
      if (m.type() === "error") errors.push(m.text());
    });
    page.on("request", (r) => {
      if (new URL(r.url()).pathname.startsWith("/api/")) calls.push(r.url());
    });
    await page.goto("/demo/intake");
    const before = await page.evaluate(() =>
      JSON.parse(localStorage.getItem("project-manage-demo-v1")!),
    );
    await page
      .getByLabel("Notes or pasted table", { exact: true })
      .fill(
        "Atlas:\n- Prepare synthetic brief\n- Coordinate Meridian\nProject: Synthetic Orchard\nOwner: Synthetic reviewer\n- Draft a checklist",
      );
    await page
      .getByRole("button", { name: "Review candidates", exact: true })
      .click();
    await expect(page.locator(".intake-candidate")).toHaveCount(3);
    const first = page.locator(".intake-candidate").nth(0),
      ambiguous = page.locator(".intake-candidate").nth(1),
      last = page.locator(".intake-candidate").nth(2);
    await expect(first.locator(".intake-matches")).toContainText("Exact alias");
    await expect(
      ambiguous.getByRole("combobox", { name: "Target project", exact: true }),
    ).toHaveValue("");
    await expect(ambiguous.locator(".intake-matches button")).toHaveCount(2);
    await ambiguous
      .locator(".intake-matches")
      .getByRole("button", { name: "Meridian Workspace", exact: true })
      .click();
    await expect(
      ambiguous.getByRole("combobox", { name: "Target project", exact: true }),
    ).toHaveValue("project-2");
    await expect(ambiguous.locator(".intake-warnings")).not.toContainText(
      "Unresolved project.",
    );
    await expect(ambiguous.locator(".intake-warnings")).toContainText(
      "Review your selected target.",
    );
    await page
      .getByLabel("I reviewed the selected rows and their target projects")
      .check();
    await expect(
      page.getByRole("button", { name: "Create confirmed items", exact: true }),
    ).toBeDisabled();
    await ambiguous
      .getByLabel("I confirm this target despite multiple project matches")
      .check();
    await ambiguous.locator(".intake-source-proof summary").click();
    await expect(ambiguous.locator(".intake-source-proof")).toContainText(
      "Context row 1",
    );
    await expect(
      ambiguous.locator(".intake-source-proof pre").first(),
    ).toHaveText("Atlas:");
    await expect(last.getByLabel("Project owner", { exact: true })).toHaveValue(
      "Synthetic reviewer",
    );
    await expect(last.getByLabel("Due date", { exact: true })).toHaveValue("");
    await expect(
      last.getByRole("combobox", { name: "Stage", exact: true }),
    ).toHaveValue("unclassified");
    mkdirSync("artifacts/intake-context", { recursive: true });
    await ambiguous.screenshot({
      path: `artifacts/intake-context/review-${width}.png`,
    });
    expect(
      (
        await new AxeBuilder({ page })
          .withTags(["wcag2a", "wcag2aa", "wcag21aa"])
          .analyze()
      ).violations,
    ).toEqual([]);
    page.once("dialog", (dialog) => dialog.accept());
    await page.reload();
    await page
      .getByRole("button", { name: "Restore draft", exact: true })
      .click();
    await expect(
      ambiguous.getByLabel(
        "I confirm this target despite multiple project matches",
      ),
    ).not.toBeChecked();
    await expect(
      ambiguous.getByRole("combobox", { name: "Target project", exact: true }),
    ).toHaveValue("project-2");
    await ambiguous
      .getByLabel("I confirm this target despite multiple project matches")
      .check();
    await page
      .getByLabel("I reviewed the selected rows and their target projects")
      .check();
    await page
      .getByRole("button", { name: "Create confirmed items", exact: true })
      .click();
    await expect(
      page.getByRole("heading", { name: "Created and recorded", exact: true }),
    ).toBeVisible();
    const after = await page.evaluate(() =>
      JSON.parse(localStorage.getItem("project-manage-demo-v1")!),
    );
    expect(after.projects.slice(0, before.projects.length)).toEqual(
      before.projects,
    );
    expect(after.tasks.length).toBe(before.tasks.length + 3);
    expect(
      after.activities.some(
        (a: { source: string }) =>
          a.source.includes("Row 1: Atlas:") &&
          a.source.includes("Row 3: - Coordinate Meridian"),
      ),
    ).toBe(true);
    await page.reload();
    await page
      .getByRole("button", { name: "Undo intake", exact: true })
      .click();
    await page
      .getByRole("button", { name: "Confirm undo", exact: true })
      .click();
    await expect(page.getByText("Undone", { exact: true })).toBeVisible();
    const restored = await page.evaluate(() =>
      JSON.parse(localStorage.getItem("project-manage-demo-v1")!),
    );
    expect(restored.projects).toEqual(before.projects);
    expect(restored.tasks).toEqual(before.tasks);
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth + 1,
      ),
    ).toBe(true);
    expect(errors).toEqual([]);
    expect(calls).toEqual([]);
  });
}
