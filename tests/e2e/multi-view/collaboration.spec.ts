import { expect, test } from "@playwright/test";
import { writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { performance } from "node:perf_hooks";
import {
  origin,
  resetWorkspace,
  runDirectory,
  sessions,
  snapshot,
} from "./support";

test("five isolated browser sessions poll confirmed changes while an old editor retains its draft", async ({
  page,
  browser,
}) => {
  test.setTimeout(120000);
  await resetWorkspace(page);
  const identities = await sessions();
  const before = await snapshot(page);
  const contexts = await Promise.all(
    identities.map((identity) =>
      browser.newContext({
        baseURL: origin,
        storageState: identity.state,
        viewport: { width: 1536, height: 1000 },
      }),
    ),
  );
  const pages = await Promise.all(contexts.map((context) => context.newPage()));
  try {
    const actors = await Promise.all(
      contexts.map(
        async (context) =>
          (await (await context.request.get("/api/auth/session")).json()).actor
            .id,
      ),
    );
    expect(new Set(actors).size).toBe(5);
    expect(
      new Set(
        identities.map(
          (identity) =>
            identity.state.cookies.find(
              (cookie) => cookie.name === "pm_session",
            )!.value,
        ),
      ).size,
    ).toBe(5);
    await Promise.all(
      pages.map(async (client) => {
        await client.addInitScript(() => {
          localStorage.setItem("project-manage-locale", "en");
          localStorage.setItem("project-manage-theme", "light");
        });
        await client.goto("/tasks?scope=all&project=project-1&view=board");
        await expect(
          client.getByRole("button", {
            name: "Confirm project scope",
            exact: true,
          }),
        ).toBeVisible();
      }),
    );
    const editor = pages[4]!;
    await editor
      .getByRole("button", { name: "Confirm project scope", exact: true })
      .click();
    await editor
      .getByRole("button", { name: "Edit task", exact: true })
      .click();
    await editor
      .getByLabel("Task title", { exact: true })
      .fill("Unsaved collaborator 4 draft");
    const writer = pages[0]!;
    await writer
      .getByRole("button", { name: "Bulk edit tasks", exact: true })
      .click();
    const bulk = writer.getByRole("dialog", {
      name: "Bulk edit tasks",
      exact: true,
    });
    await bulk
      .getByRole("checkbox", { name: /^Confirm project scope / })
      .check();
    await bulk
      .getByRole("combobox", { name: "New status", exact: true })
      .selectOption("blocked");
    await bulk
      .getByRole("checkbox", {
        name: "I confirm replacing this field on the selected tasks.",
        exact: true,
      })
      .check();
    const receipt = writer.waitForResponse(
      (response) =>
        response.url().endsWith("/api/tasks/bulk-update") &&
        response.request().method() === "POST",
    );
    await bulk
      .getByRole("button", { name: "Apply selected changes", exact: true })
      .click();
    expect((await receipt).status()).toBe(200);
    const acknowledgedAt = performance.now();
    await expect(bulk).toContainText("Confirmed 1 selected tasks.");
    await bulk.getByRole("button", { name: "Close", exact: true }).click();
    const samples = await Promise.all(
      pages.map(async (client, index) => {
        await expect(
          client.locator('.board-column[aria-label="Needs coordination"]'),
        ).toContainText("Confirm project scope", { timeout: 25000 });
        return {
          client: index,
          milliseconds: performance.now() - acknowledgedAt,
          editorOpen: index === 4,
        };
      }),
    );
    await expect(editor.getByLabel("Task title", { exact: true })).toHaveValue(
      "Unsaved collaborator 4 draft",
    );
    const snapshots = await Promise.all(
      pages.map((client) => snapshot(client)),
    );
    const saved = snapshots[0]!.tasks.find((task) => task.id === "task-1")!;
    expect(saved.status).toBe("blocked");
    for (const current of snapshots)
      expect(current.tasks.find((task) => task.id === saved.id)).toEqual(saved);
    const stale = editor.waitForResponse(
      (response) =>
        response.url().endsWith("/api/tasks/task-1") &&
        response.request().method() === "PUT",
    );
    await editor
      .getByRole("button", { name: "Save task", exact: true })
      .click();
    expect((await stale).status()).toBe(409);
    await expect(editor.getByLabel("Task title", { exact: true })).toHaveValue(
      "Unsaved collaborator 4 draft",
    );
    const after = await snapshot(page);
    expect(after.tasks.find((task) => task.id === saved.id)).toEqual(saved);
    expect(after.tasks.find((task) => task.id === saved.id)!.title).toBe(
      before.tasks.find((task) => task.id === saved.id)!.title,
    );
    writeFileSync(
      resolve(runDirectory, "five-browser-poll.json"),
      JSON.stringify(
        {
          scope:
            "Five independent authenticated browser contexts; one healthy-network poll cycle. Editor client is asserted through its underlying board DOM plus retained visible editor, not an unobstructed board.",
          samples,
        },
        null,
        2,
      ),
    );
    await editor.screenshot({
      path: resolve(runDirectory, "collaborator-draft-conflict.png"),
    });
  } finally {
    await Promise.all(contexts.map((context) => context.close()));
  }
});
