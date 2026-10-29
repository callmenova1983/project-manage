import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { randomUUID, randomBytes } from "node:crypto";
import { buildApp } from "../../apps/api/src/app";
import { assistantProjectCsv } from "../../packages/domain/assistant-plan";
import { taskInput, projectInput } from "../../packages/domain/types";
import { createUser } from "../../apps/api/src/auth";
import {
  intakeCandidates,
  parseDelimited,
  type IntakeInput,
  type IntakeSource,
} from "../../packages/domain/intake";
let context: Awaited<ReturnType<typeof buildApp>>,
  cookie = "",
  csrf = "";
const origin = "http://localhost:4173";
const source: IntakeSource = {
  kind: "csv",
  name: "intake.csv",
  sheet: "",
  text: "Project,Client,Task\nNew intake,Example,First\nNew intake,Example,Second",
  rows: [
    ["Project", "Client", "Task"],
    ["New intake", "Example", "First"],
    ["New intake", "Example", "Second"],
  ],
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
  context = await buildApp({ isolatedDatabase: true, origin });
  await context.repo.seed("a");
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
  it("persists model-structured client/project/address fields and reuses the project without duplicate writes", async () => {
    const before = await context.repo.snapshot("a");
    const natural: IntakeSource = {
      kind: "text",
      name: "AI 录入",
      sheet: "",
      text: assistantProjectCsv(
        [
          {
            projectId: null,
            name: "数字城市项目",
            client: "重庆市市院",
            address: "重庆",
            quote: "客户名字 重庆市市院， 数字城市项目，地址是重庆",
          },
        ],
        [],
      ),
    };
    natural.rows = parseDelimited(natural.text);
    const payload = async () => ({
      source: natural,
      confirmed: true,
      rows: intakeCandidates(
        natural,
        (await context.repo.snapshot("a")).projects,
      ).map((c) => ({
        sourceRow: c.sourceRow,
        sourcePart: c.sourcePart,
        contextRows: c.contextRows,
        project: c.project,
        task: c.task,
        targetProjectId: c.targetProjectId,
        targetProjectVersion: c.targetProjectVersion,
        duplicateConfirmed: false,
      })),
    });
    const created = await request("POST", "/api/intakes", await payload());
    expect(created.statusCode).toBe(200);
    const after = await context.repo.snapshot("a");
    expect(after.projects).toHaveLength(before.projects.length + 1);
    expect(after.tasks).toEqual(before.tasks);
    const saved = after.projects.find((p) => p.name === "数字城市项目")!;
    expect(saved).toMatchObject({
      client: "重庆市市院",
      description: "地址：重庆",
      owner: "Unassigned",
    });
    const repeat = await request("POST", "/api/intakes", await payload());
    expect(repeat.statusCode).toBe(200);
    expect(repeat.json()).toMatchObject({
      projects: [],
      tasks: [],
      entries: [{ projectId: saved.id, taskId: null }],
    });
    expect(await context.repo.snapshot("a")).toEqual(after);
    // Reusing an existing project must never grant an undo that deletes it.
    expect(
      (
        await request("POST", `/api/intakes/${repeat.json().id}/undo`, {
          confirmed: true,
        })
      ).statusCode,
    ).toBe(200);
    expect(await context.repo.snapshot("a")).toEqual(after);
    expect(
      (
        await request("POST", `/api/intakes/${created.json().id}/undo`, {
          confirmed: true,
        })
      ).statusCode,
    ).toBe(200);
    expect((await context.repo.snapshot("a")).projects).toEqual(
      before.projects,
    );
  });
  it("creates one project and two tasks once, preserves source and can undo the batch", async () => {
    const key = randomUUID(),
      before = await context.repo.snapshot("a");
    const a = await request("POST", "/api/intakes", input(), key);
    expect(a.statusCode).toBe(200);
    const batch = a.json();
    expect(batch.projects).toHaveLength(1);
    expect(batch.tasks).toHaveLength(2);
    expect(
      (await request("POST", "/api/intakes", input(), key)).json().id,
    ).toBe(batch.id);
    expect((await context.repo.snapshot("a")).projects).toHaveLength(
      before.projects.length + 1,
    );
    expect((await context.repo.snapshot("a")).activities[0]!.source).toContain(
      "Row",
    );
    expect((await request("GET", "/api/intakes")).json()).toHaveLength(1);
    expect(
      (
        await request("POST", `/api/intakes/${batch.id}/undo`, {
          confirmed: true,
        })
      ).statusCode,
    ).toBe(200);
    expect((await context.repo.snapshot("a")).tasks).toHaveLength(
      before.tasks.length,
    );
    expect((await context.repo.snapshot("a")).projects).toHaveLength(
      before.projects.length,
    );
  });
  it("rolls back all writes on an invalid later row and rejects unconfirmed input", async () => {
    const before = await context.repo.snapshot("a"),
      data = input();
    data.rows[0]!.project.owner = "First known owner";
    data.rows[1]!.project.owner = "Conflicting owner";
    expect((await request("POST", "/api/intakes", data)).statusCode).toBe(400);
    expect(await context.repo.snapshot("a")).toEqual(before);
    expect(
      (await request("POST", "/api/intakes", { ...input(), confirmed: false }))
        .statusCode,
    ).toBe(400);
  });
  it("protects newer changes and workspace isolation during undo", async () => {
    const batch = (await request("POST", "/api/intakes", input())).json();
    const p = batch.projects[0];
    await context.repo.putProject("a", { ...p, version: 2 });
    expect(
      (
        await request("POST", `/api/intakes/${batch.id}/undo`, {
          confirmed: true,
        })
      ).statusCode,
    ).toBe(400);
    expect(
      (await context.repo.snapshot("a")).projects.some((x) => x.id === p.id),
    ).toBe(true);
    await context.repo.workspace("b");
    await context.repo.db.prepare("UPDATE users SET workspace_id='b'").run();
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
    kind: "csv" as const,
    name: "Explicit task table",
    sheet: "",
    text: "Task,Due date\n准备讨论,下周五",
    rows: [
      ["Task", "Due date"],
      ["准备讨论", "下周五"],
    ],
  };
  const c = intakeCandidates(
    source,
    (await context.repo.snapshot("a")).projects,
  )[0]!;
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
  const target = (await context.repo.snapshot("a")).projects.find(
    (x) => x.id !== p.id,
  )!;
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
  const snapshot = await context.repo.snapshot("a");
  expect(snapshot.tasks.find((t) => t.id === task.id)).toMatchObject({
    projectId: target.id,
    dueDate: "2026-10-16",
    version: 2,
  });
  expect(
    snapshot.activities.some(
      (e) => e.entityId === task.id && e.source.includes("准备讨论"),
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
  const before = await context.repo.snapshot("a"),
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
  await context.repo.workspace("other");
  await context.repo.putProject("other", {
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
  expect(await context.repo.snapshot("a")).toEqual(before);
});
