import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { randomUUID, randomBytes } from "node:crypto";
import { buildApp } from "../../apps/api/src/app";
import { taskInput, projectInput } from "../../packages/domain/types";
import { createUser } from "../../apps/api/src/auth";
import {
  intakeCandidates,
  type IntakeInput,
  type IntakeSource,
} from "../../packages/domain/intake";
let context: Awaited<ReturnType<typeof buildApp>>,
  cookie = "",
  csrf = "";
const origin = "http://localhost:4173";
const source: IntakeSource = {
  kind: "text",
  name: "intake.txt",
  sheet: "",
  text: "Project: New intake; Client: Example; Task: First\nProject: New intake; Client: Example; Task: Second",
};
function input(): IntakeInput {
  return {
    source,
    confirmed: true,
    rows: intakeCandidates(source, []).map((c) => ({
      sourceRow: c.sourceRow,
      targetProjectId: "",
      targetProjectVersion: null,
      project: c.project,
      task: c.task,
      duplicateConfirmed: false,
    })),
  };
}
const request = (
  method: "GET" | "POST" | "PUT",
  url: string,
  payload?: unknown,
  key = randomUUID(),
) =>
  context.app.inject({
    method,
    url,
    payload: payload as Record<string, unknown>,
    headers: { origin, cookie, "x-csrf-token": csrf, "idempotency-key": key },
  });
beforeEach(async () => {
  context = await buildApp({ databasePath: ":memory:", origin });
  context.repo.seed("a");
  const password = randomBytes(24).toString("hex");
  await createUser(context.repo, {
    email: "intake@example.test",
    name: "Member",
    workspaceId: "a",
    password,
  });
  const login = await context.app.inject({
    method: "POST",
    url: "/api/auth/login",
    payload: { email: "intake@example.test", password },
    headers: { origin },
  });
  cookie = `pm_session=${login.cookies[0]!.value}`;
  csrf = login.json().csrf;
});
afterEach(async () => {
  await context.app.close();
});
describe("transactional reviewed intake", () => {
  it("creates one project and two tasks once, preserves source and can undo the batch", async () => {
    const key = randomUUID(),
      before = context.repo.snapshot("a");
    const a = await request("POST", "/api/intakes", input(), key);
    expect(a.statusCode).toBe(200);
    const batch = a.json();
    expect(batch.projects).toHaveLength(1);
    expect(batch.tasks).toHaveLength(2);
    expect(
      (await request("POST", "/api/intakes", input(), key)).json().id,
    ).toBe(batch.id);
    expect(context.repo.snapshot("a").projects).toHaveLength(
      before.projects.length + 1,
    );
    expect(context.repo.snapshot("a").activities[0]!.source).toContain("Row");
    expect((await request("GET", "/api/intakes")).json()).toHaveLength(1);
    expect(
      (
        await request("POST", `/api/intakes/${batch.id}/undo`, {
          confirmed: true,
        })
      ).statusCode,
    ).toBe(200);
    expect(context.repo.snapshot("a").tasks).toHaveLength(before.tasks.length);
    expect(context.repo.snapshot("a").projects).toHaveLength(
      before.projects.length,
    );
  });
  it("rolls back all writes on an invalid later row and rejects unconfirmed input", async () => {
    const before = context.repo.snapshot("a"),
      data = input();
    data.rows[0]!.project.owner = "First known owner";
    data.rows[1]!.project.owner = "Conflicting owner";
    expect((await request("POST", "/api/intakes", data)).statusCode).toBe(400);
    expect(context.repo.snapshot("a")).toEqual(before);
    expect(
      (await request("POST", "/api/intakes", { ...input(), confirmed: false }))
        .statusCode,
    ).toBe(400);
  });
  it("protects newer changes and workspace isolation during undo", async () => {
    const batch = (await request("POST", "/api/intakes", input())).json();
    const p = batch.projects[0];
    context.repo.putProject("a", { ...p, version: 2 });
    expect(
      (
        await request("POST", `/api/intakes/${batch.id}/undo`, {
          confirmed: true,
        })
      ).statusCode,
    ).toBe(400);
    expect(context.repo.snapshot("a").projects.some((x) => x.id === p.id)).toBe(
      true,
    );
    context.repo.workspace("b");
    context.repo.db.prepare("UPDATE users SET workspace_id='b'").run();
    expect((await request("GET", "/api/intakes")).json()).toEqual([]);
    expect(
      (
        await request("POST", `/api/intakes/${batch.id}/undo`, {
          confirmed: true,
        })
      ).statusCode,
    ).toBe(404);
  });
});

it("persists missing details, later completes a project and reassigns a standalone task with optimistic concurrency", async () => {
  const source = {
    kind: "text" as const,
    name: "Synthetic fragmented notes",
    sheet: "",
    text: "任务：准备讨论；日期：下周五",
  };
  const c = intakeCandidates(source, context.repo.snapshot("a").projects)[0]!;
  const res = await request("POST", "/api/intakes", {
    source,
    confirmed: true,
    rows: [
      {
        sourceRow: c.sourceRow,
        sourcePart: c.sourcePart,
        project: c.project,
        task: c.task,
        targetProjectId: c.targetProjectId,
        targetProjectVersion: c.targetProjectVersion,
        duplicateConfirmed: false,
      },
    ],
  });
  expect(res.statusCode).toBe(200);
  const batch = res.json(),
    p = batch.projects[0],
    task = batch.tasks[0];
  expect(p).toMatchObject({
    client: "",
    stage: "unclassified",
    owner: "Unassigned",
  });
  expect(task).toMatchObject({ assignee: "Unassigned", dueDate: null });
  const completed = await request("PUT", `/api/projects/${p.id}`, {
    ...projectInput.strip().parse(p),
    client: "Confirmed later",
    stage: "proposal",
    owner: "Synthetic owner",
    version: p.version,
  });
  expect(completed.statusCode).toBe(200);
  const target = context.repo
    .snapshot("a")
    .projects.find((x) => x.id !== p.id)!;
  const edit = {
    ...taskInput.strip().parse(task),
    projectId: target.id,
    dueDate: "2026-10-16",
    assignee: "Synthetic assignee",
    version: task.version,
  };
  expect((await request("PUT", `/api/tasks/${task.id}`, edit)).statusCode).toBe(
    200,
  );
  expect((await request("PUT", `/api/tasks/${task.id}`, edit)).statusCode).toBe(
    409,
  );
  const snapshot = context.repo.snapshot("a");
  expect(snapshot.tasks.find((t) => t.id === task.id)).toMatchObject({
    projectId: target.id,
    dueDate: "2026-10-16",
    version: 2,
  });
  expect(
    snapshot.activities.some(
      (e) => e.entityId === task.id && e.source.includes(source.text),
    ),
  ).toBe(true);
  expect(
    (
      await request("POST", `/api/intakes/${batch.id}/undo`, {
        confirmed: true,
      })
    ).statusCode,
  ).toBe(400);
});

it("rejects moving parents, children or cross-workspace targets without partial writes", async () => {
  const before = context.repo.snapshot("a"),
    child = before.tasks.find((t) => t.parentId)!,
    parent = before.tasks.find((t) => t.id === child.parentId)!,
    target = before.projects.find((p) => p.id !== child.projectId)!;
  for (const task of [child, parent])
    expect(
      (
        await request("PUT", `/api/tasks/${task.id}`, {
          ...taskInput.strip().parse(task),
          projectId: target.id,
          parentId: null,
          version: task.version,
        })
      ).statusCode,
    ).toBe(400);
  context.repo.workspace("other");
  context.repo.putProject("other", {
    ...target,
    id: "other-workspace-project",
  });
  const standalone = before.tasks.find(
    (t) => !t.parentId && !before.tasks.some((x) => x.parentId === t.id),
  )!;
  expect(
    (
      await request("PUT", `/api/tasks/${standalone.id}`, {
        ...taskInput.strip().parse(standalone),
        projectId: "other-workspace-project",
        version: standalone.version,
      })
    ).statusCode,
  ).toBe(404);
  expect(context.repo.snapshot("a")).toEqual(before);
});
