import { mkdirSync, writeFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { expect } from "@playwright/test";
import { fixture } from "./reliability-fixture.mjs";
const f = await fixture(),
  groups = [],
  errors = [],
  injected = [];
try {
  mkdirSync("artifacts", { recursive: true });
  const sessions = [];
  for (let i = 0; i < 5; i++) {
    const s = await f.session(i, i % 2 ? 390 : 1536);
    s.page.on("pageerror", (e) => errors.push(e.message));
    s.page.on("console", (m) => {
      if (m.type() !== "error") return;
      const path = new URL(m.location().url || "/", f.origin).pathname;
      if (
        (s.faultWindow &&
          path.startsWith("/api/") &&
          /net::ERR_(FAILED|INTERNET_DISCONNECTED)/.test(m.text())) ||
        (path === s.projectPath && /status of 409/.test(m.text()))
      )
        injected.push({ path, error: m.text() });
      else errors.push(m.text());
    });
    await s.page.goto("/projects");
    await expect(s.page.locator(".project-row")).toHaveCount(20);
    sessions.push(s);
  }
  expect(new Set(sessions.map((s) => s.auth.actor.id)).size).toBe(5);
  expect(
    new Set(
      (await Promise.all(sessions.map((s) => s.context.cookies()))).map(
        (c) => c.find((c) => c.name === "pm_session").value,
      ),
    ).size,
  ).toBe(5);
  for (let round = 0; round < 20; round++) {
    const started = performance.now(),
      project = f.projects[round],
      path = `/api/projects/${project.id}`;
    const initialStatuses = [],
      retryStatuses = [],
      keys = sessions.map(() => []);
    await Promise.all(
      sessions.map(async (s, i) => {
        s.projectPath = path;
        s.faultWindow = true;
        await s.page
          .getByLabel("Search projects", { exact: true })
          .fill(project.name);
        await s.page
          .getByRole("button", { name: `Expand ${project.name}`, exact: true })
          .click();
        await s.page
          .getByLabel(`Original notes for ${project.name}`)
          .fill(`Synthetic group ${round + 1}, member ${i + 1}`);
        s.capture = (request) => {
          if (
            new URL(request.url()).pathname === path &&
            request.method() === "PUT"
          )
            keys[i].push(request.headers()["idempotency-key"]);
        };
        s.page.on("request", s.capture);
        await s.page.route(`**${path}`, async (route) => {
          if (route.request().method() !== "PUT") return route.continue();
          const response = await route.fetch();
          initialStatuses[i] = response.status();
          await route.abort("failed"); // Request reached SQLite; its response is deliberately lost.
        });
      }),
    );
    await Promise.all(
      sessions.map(async (s) => {
        await s.page
          .getByRole("button", { name: "Save notes", exact: true })
          .click();
        await expect(
          s.page.locator(".inline-notes [role=alert]"),
        ).toContainText("Unable to reach the server");
      }),
    );
    expect([...initialStatuses].sort()).toEqual([200, 409, 409, 409, 409]);
    // Browser-level offline, not a mocked successful save. All five drafts must survive.
    await Promise.all(
      sessions.map(async (s, i) => {
        await s.page.unroute(`**${path}`);
        await s.context.setOffline(true);
        await s.page.waitForTimeout(350);
        const failed = s.page.waitForEvent(
          "requestfailed",
          (r) => new URL(r.url()).pathname === path,
        );
        await s.page
          .getByRole("button", { name: "Save notes", exact: true })
          .click();
        await failed;
        await expect(
          s.page.getByLabel(`Original notes for ${project.name}`),
        ).toHaveValue(`Synthetic group ${round + 1}, member ${i + 1}`);
        await expect(
          s.page.getByRole("button", { name: "Save notes", exact: true }),
        ).toBeEnabled();
        await s.context.setOffline(false);
        await s.page.waitForTimeout(350);
        await expect(
          s.page.getByLabel(`Original notes for ${project.name}`),
        ).toHaveValue(`Synthetic group ${round + 1}, member ${i + 1}`);
        const received = s.page.waitForResponse(
          (r) =>
            new URL(r.url()).pathname === path &&
            r.request().method() === "PUT",
        );
        await s.page
          .getByRole("button", { name: "Save notes", exact: true })
          .click();
        retryStatuses[i] = (await received).status();
        if (retryStatuses[i] === 409) {
          await expect(
            s.page.locator(".inline-notes [role=alert]"),
          ).toContainText("Latest saved version 2");
          await expect(
            s.page.getByLabel(`Original notes for ${project.name}`),
          ).toHaveValue(`Synthetic group ${round + 1}, member ${i + 1}`);
          if (round === 19 && i % 2 === 1)
            await s.page.locator(".inline-notes").screenshot({
              path: `artifacts/collaboration-conflict-${i}.png`,
            });
          await s.page
            .getByRole("button", { name: "Load latest version", exact: true })
            .click();
        }
        await expect(
          s.page.getByRole("button", { name: "Save notes", exact: true }),
        ).toHaveCount(0);
        s.page.off("request", s.capture);
        s.faultWindow = false;
      }),
    );
    expect(retryStatuses).toEqual(initialStatuses);
    for (const attempts of keys) {
      expect(attempts).toHaveLength(3);
      expect(new Set(attempts).size).toBe(1);
    }
    const winner = initialStatuses.indexOf(200);
    const saved = await (await sessions[0].context.request.get(path)).json();
    expect(saved.version).toBe(2);
    expect(saved.notes).toBe(
      `Synthetic group ${round + 1}, member ${winner + 1}`,
    );
    // Concurrent duplicate creation in each independent account must create only five tasks, not ten.
    const taskIds = await Promise.all(
      sessions.map(async (s, i) => {
        const options = {
          headers: {
            "x-csrf-token": s.auth.csrf,
            "idempotency-key": randomUUID(),
          },
          data: {
            projectId: project.id,
            parentId: null,
            title: `Synthetic repeated creation ${round + 1}/${i + 1}`,
            description: "Synthetic only",
            status: "todo",
            assignee: "Unassigned",
            workWeek: null,
            workDates: [],
            dueDate: null,
          },
        };
        const replies = await Promise.all([
          s.context.request.post("/api/tasks", options),
          s.context.request.post("/api/tasks", options),
        ]);
        for (const r of replies) expect(r.status()).toBe(200);
        const [a, b] = await Promise.all(replies.map((r) => r.json()));
        expect(a).toEqual(b);
        return a.id;
      }),
    );
    expect(new Set(taskIds).size).toBe(5);
    groups.push({
      group: round + 1,
      sessions: 5,
      firstResponsesLost: initialStatuses,
      recoveredResponses: retryStatuses,
      originalKeysPreserved: true,
      draftPreserved: true,
      committedProjectVersions: 1,
      createdTasks: taskIds.length,
    });
    writeFileSync(
      "artifacts/collaboration-progress.json",
      JSON.stringify({ completedGroups: groups.length, groups }, null, 2),
    );
    console.log(
      `Collaboration ${round + 1}/20: one write, four explicit conflicts, five drafts retained, duplicate creations deduplicated`,
    );
    // Keep synthetic loopback traffic within the production's unchanged 300/minute limit.
    await sessions[0].page.waitForTimeout(
      Math.max(0, 8000 - (performance.now() - started)),
    );
  }
  const snapshot = await (
    await sessions[0].context.request.get("/api/workspace")
  ).json();
  expect(snapshot.projects).toHaveLength(20);
  expect(snapshot.projects.every((p) => p.version === 2)).toBe(true);
  expect(snapshot.tasks).toHaveLength(100);
  expect(snapshot.activities).toHaveLength(120);
  expect(snapshot.activities.filter((a) => a.kind === "project")).toHaveLength(
    20,
  );
  expect(snapshot.activities.filter((a) => a.kind === "task")).toHaveLength(
    100,
  );
  expect(errors).toEqual([]);
  mkdirSync("artifacts", { recursive: true });
  await sessions[1].page.screenshot({
    path: "artifacts/collaboration-mobile.png",
    fullPage: true,
  });
  writeFileSync(
    "artifacts/collaboration.json",
    JSON.stringify(
      {
        environment: f.environment,
        independentAccounts: 5,
        independentCookieJars: 5,
        groups,
        exactFinalCounts: {
          projects: 20,
          projectUpdates: 20,
          tasks: 100,
          auditRecords: 120,
        },
        unexpectedBrowserErrors: errors,
        expectedInjectedNetworkAndConflictErrors: injected.length,
        limits:
          "Synthetic loopback browser faults; no real network, multi-process database, physical device or production deployment claim",
      },
      null,
      2,
    ),
  );
} finally {
  await f.close();
}
