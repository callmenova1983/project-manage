import { afterEach, beforeEach, expect, it } from "vitest";
import { randomBytes, randomUUID } from "node:crypto";
import { buildApp } from "../../apps/api/src/app";
import { createUser } from "../../apps/api/src/auth";
import {
  projectInput,
  taskInput,
  type Project,
  type Snapshot,
} from "../../packages/domain/types";

let context: Awaited<ReturnType<typeof buildApp>>, cookie: string, csrf: string;
const origin = "http://localhost:4173";
beforeEach(async () => {
  context = await buildApp({ databasePath: ":memory:", origin });
  context.repo.seed("lifecycle");
  const password = randomBytes(24).toString("hex");
  await createUser(context.repo, {
    workspaceId: "lifecycle",
    name: "Member",
    email: "member@example.test",
    password,
  });
  const response = await context.app.inject({
    method: "POST",
    url: "/api/auth/login",
    headers: { origin },
    payload: { email: "member@example.test", password },
  });
  cookie = `pm_session=${response.cookies[0]!.value}`;
  csrf = response.json().csrf;
});
afterEach(async () => context.app.close());
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
    headers: { cookie, origin, "x-csrf-token": csrf, "idempotency-key": key },
  });
const snapshot = async () =>
  (await request("GET", "/api/workspace")).json<Snapshot>();

it("closes, filters, reactivates for a bug fix and retains all project facts with idempotent audit", async () => {
  const before = await snapshot(),
    project = before.projects[0]!;
  const body = {
      version: project.version,
      lifecycle: "closed",
      confirmOpenTasks: true,
    },
    key = randomUUID();
  expect(
    (
      await request("POST", `/api/projects/${project.id}/lifecycle`, {
        ...body,
        confirmOpenTasks: false,
      })
    ).statusCode,
  ).toBe(409);
  expect(await snapshot()).toEqual(before);
  const response = await request(
    "POST",
    `/api/projects/${project.id}/lifecycle`,
    body,
    key,
  );
  expect(response.statusCode).toBe(200);
  const closed = response.json<Project>();
  expect(
    (
      await request("POST", `/api/projects/${project.id}/lifecycle`, body, key)
    ).json(),
  ).toEqual(closed);
  expect(
    (await request("GET", "/api/projects"))
      .json<Project[]>()
      .some((p) => p.id === project.id),
  ).toBe(false);
  expect(
    (await request("GET", "/api/projects?lifecycle=closed")).json<Project[]>(),
  ).toEqual([closed]);
  expect((await request("GET", `/api/projects/${project.id}`)).json()).toEqual(
    closed,
  );
  const note = await request("PUT", `/api/projects/${project.id}`, {
    ...projectInput.strip().parse(closed),
    notes: "待后续维修",
    version: closed.version,
  });
  expect(note.json().lifecycle).toBe("closed");
  const active = await request(
    "POST",
    `/api/projects/${project.id}/lifecycle`,
    { version: note.json().version, lifecycle: "active" },
  );
  expect(active.statusCode).toBe(200);
  expect(active.json()).toMatchObject({
    stage: project.stage,
    lifecycle: "active",
    notes: "待后续维修",
  });
  const after = await snapshot();
  expect(after.tasks).toEqual(before.tasks);
  expect(
    after.activities.filter(
      (a) => a.entityId === project.id && a.source === "Project lifecycle",
    ),
  ).toHaveLength(2);
  const bug = await request("POST", "/api/tasks", {
    ...taskInput.strip().parse(before.tasks[0]!),
    projectId: project.id,
    parentId: null,
    title: "修复偶发 bug",
  });
  expect(bug.statusCode).toBe(200);
});

it("enforces archived read-only projects, tasks, progress, files and merges with atomic rollback", async () => {
  const before = await snapshot(),
    project = before.projects[0]!;
  const file = await request("POST", `/api/projects/${project.id}/files`, {
    name: "maintenance.txt",
    data: Buffer.from("维修资料").toString("base64"),
  });
  expect(file.statusCode).toBe(200);
  const archivedResponse = await request(
    "POST",
    `/api/projects/${project.id}/lifecycle`,
    { version: project.version, lifecycle: "archived", confirmOpenTasks: true },
  );
  expect(archivedResponse.statusCode).toBe(200);
  const archived = archivedResponse.json<Project>();
  const checkpoint = await snapshot();
  const task = before.tasks.find(
    (t) =>
      t.projectId === project.id &&
      !before.tasks.some((c) => c.parentId === t.id),
  )!;
  const writes: ["POST" | "PUT", string, unknown][] = [
    [
      "PUT",
      `/api/projects/${project.id}`,
      {
        ...projectInput.strip().parse(archived),
        name: "forbidden",
        version: archived.version,
      },
    ],
    [
      "PUT",
      `/api/projects/${project.id}/name`,
      { name: "forbidden", version: archived.version },
    ],
    [
      "POST",
      `/api/projects/${project.id}/progress`,
      { text: "forbidden", mode: "new", version: archived.version },
    ],
    [
      "PUT",
      `/api/tasks/${task.id}`,
      {
        ...taskInput.strip().parse(task),
        status: "done",
        version: task.version,
      },
    ],
    [
      "POST",
      "/api/tasks",
      { ...taskInput.strip().parse(task), title: "forbidden" },
    ],
    [
      "POST",
      `/api/projects/${project.id}/files`,
      { name: "forbidden.txt", data: Buffer.from("data").toString("base64") },
    ],
    [
      "POST",
      `/api/projects/${project.id}/materials`,
      { name: "forbidden.txt", data: Buffer.from("data").toString("base64") },
    ],
    [
      "POST",
      "/api/projects/merge",
      {
        targetId: before.projects[1]!.id,
        sourceIds: [project.id],
        name: "merged",
        revision: checkpoint.revision,
        confirmed: true,
      },
    ],
  ];
  for (const [method, url, body] of writes) {
    const result = await request(method, url, body);
    expect(result.statusCode, `${method} ${url}: ${result.body}`).toBe(409);
    expect(await snapshot()).toEqual(checkpoint);
  }
  expect(
    (await request("GET", `/api/projects/${project.id}/files`)).json(),
  ).toHaveLength(1);
  expect(
    (await request("GET", `/api/projects/${project.id}/progress`)).statusCode,
  ).toBe(200);
  const restored = await request(
    "POST",
    `/api/projects/${project.id}/lifecycle`,
    { lifecycle: "closed", version: archived.version, confirmOpenTasks: true },
  );
  expect(restored.statusCode).toBe(200);
  expect(
    (
      await request("POST", `/api/projects/${project.id}/progress`, {
        text: "补充维修记录",
        mode: "new",
        version: restored.json().version,
      })
    ).statusCode,
  ).toBe(200);
});

it("rejects stale transitions and lifecycle changes through generic editors or history restores", async () => {
  const before = await snapshot(),
    project = before.projects[0]!;
  const closed = await request(
    "POST",
    `/api/projects/${project.id}/lifecycle`,
    { version: project.version, lifecycle: "closed", confirmOpenTasks: true },
  );
  const checkpoint = await snapshot();
  expect(
    (
      await request("POST", `/api/projects/${project.id}/lifecycle`, {
        version: project.version,
        lifecycle: "active",
      })
    ).statusCode,
  ).toBe(409);
  expect(
    (
      await request("PUT", `/api/projects/${project.id}`, {
        ...projectInput.strip().parse(project),
        lifecycle: "active",
        version: closed.json().version,
      })
    ).statusCode,
  ).toBe(400);
  const event = checkpoint.activities.find(
    (a) => a.source === "Project lifecycle",
  )!;
  expect(
    (
      await request("POST", `/api/activities/${event.id}/restore`, {
        version: closed.json().version,
      })
    ).statusCode,
  ).toBe(400);
  expect(await snapshot()).toEqual(checkpoint);
});

it("preserves archived projects and their tasks through a complete export and restore", async () => {
  const before = await snapshot(),
    project = before.projects[0]!;
  await request("POST", `/api/projects/${project.id}/lifecycle`, {
    version: project.version,
    lifecycle: "archived",
    confirmOpenTasks: true,
  });
  const exported = (await request("GET", "/api/export")).json<Snapshot>();
  const restored = await request("POST", "/api/import", {
    ...exported,
    revision: exported.revision,
    confirmed: true,
  });
  expect(restored.statusCode, restored.body).toBe(200);
  const after = await snapshot();
  expect(after.projects.find((p) => p.id === project.id)).toMatchObject({
    lifecycle: "archived",
    stage: project.stage,
    notes: project.notes,
  });
  expect(
    after.tasks
      .filter((t) => t.projectId === project.id)
      .map((t) => [t.id, t.status]),
  ).toEqual(
    before.tasks
      .filter((t) => t.projectId === project.id)
      .map((t) => [t.id, t.status]),
  );
  expect(
    (
      await request("POST", `/api/projects/${project.id}/progress`, {
        version: after.projects.find((p) => p.id === project.id)!.version,
        mode: "new",
        text: "forbidden",
      })
    ).statusCode,
  ).toBe(409);
});

it("cannot change a project belonging to another workspace", async () => {
  context.repo.seed("other");
  const project = {
    ...context.repo.snapshot("other").projects[0]!,
    id: randomUUID(),
  };
  context.repo.putProject("other", project);
  const checkpoint = context.repo.snapshot("other");
  expect(
    (
      await request("POST", `/api/projects/${project.id}/lifecycle`, {
        version: project.version,
        lifecycle: "archived",
        confirmOpenTasks: true,
      })
    ).statusCode,
  ).toBe(404);
  expect(context.repo.snapshot("other")).toEqual(checkpoint);
});
