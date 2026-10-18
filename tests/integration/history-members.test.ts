import { beforeEach, afterEach, it, expect, vi } from "vitest";
vi.mock("../../apps/web/src/services/mode", () => ({ browserDemo: false }));
import { randomBytes, randomUUID } from "node:crypto";
import { buildApp } from "../../apps/api/src/app";
import { createUser } from "../../apps/api/src/auth";
import { HttpApi } from "../../apps/web/src/services/api";
import {
  projectInput,
  taskInput,
  type Activity,
  type Snapshot,
} from "../../packages/domain/types";
import type {
  ActivityPage,
  ActivityQuery,
} from "../../packages/domain/activity-query";
import {
  queryActivities,
  compareActivities,
} from "../../packages/domain/activity-query";

let ctx: Awaited<ReturnType<typeof buildApp>>, cookie: string, csrf: string;
let members: string[] = [];
const origin = "http://localhost:4173";
beforeEach(async () => {
  ctx = await buildApp({ databasePath: ":memory:", origin });
  ctx.repo.seed("team");
  const password = randomBytes(24).toString("hex");
  for (const [email, workspaceId] of [
    ["one@example.test", "team"],
    ["two@example.test", "team"],
    ["outside@example.test", "other"],
  ]) {
    await createUser(ctx.repo, {
      name: "Same Name",
      email: email!,
      workspaceId: workspaceId!,
      password,
    });
  }
  members = ["one@example.test", "two@example.test"].map(
    (email) => ctx.repo.members("team").find((m) => m.email === email)!.id,
  );
  const login = await ctx.app.inject({
    method: "POST",
    url: "/api/auth/login",
    headers: { origin },
    payload: { email: "one@example.test", password },
  });
  cookie = `pm_session=${login.cookies[0]!.value}`;
  csrf = login.json().csrf;
});
afterEach(async () => {
  vi.unstubAllGlobals();
  await ctx.app.close();
});
function request(
  method: "POST" | "PUT" | "GET",
  url: string,
  payload?: unknown,
) {
  return ctx.app.inject({
    method,
    url,
    payload: payload as Record<string, unknown>,
    headers: {
      origin,
      cookie,
      "x-csrf-token": csrf,
      "idempotency-key": randomUUID(),
    },
  });
}
function event(
  id: string,
  createdAt = "2020-10-07T12:00:00.000Z",
  projectId: string | null = "project-1",
): Activity {
  return {
    id,
    createdAt,
    projectId,
    entityId: projectId ?? "team",
    kind: "project",
    action: "Updated project",
    actor: "Synthetic member",
    source: "Synthetic full-history test",
    before: null,
    after: null,
  };
}
async function page(query: ActivityQuery) {
  const response = await request("POST", "/api/activity/query", query);
  expect(response.statusCode).toBe(200);
  return response.json<ActivityPage>();
}
it("recovers missing and rotated history tokens against the authenticated API without bypassing CSRF", async () => {
  ctx.repo.audit("team", event("client-token-recovery"));
  const responses: { url: string; status: number }[] = [];
  vi.stubGlobal("fetch", async (url: string, init: RequestInit) => {
    const response = await ctx.app.inject({
      method: init.method as "GET" | "POST",
      url,
      headers: {
        ...Object.fromEntries(new Headers(init.headers)),
        origin,
        cookie,
      },
      payload: init.body as string | undefined,
    });
    responses.push({ url, status: response.statusCode });
    return new Response(response.body, { status: response.statusCode });
  });
  const api = new HttpApi();
  const query = { projectIds: ["project-1"], excludeSeed: true };
  expect(
    (await api.activityPage(query)).events.map((item) => item.id),
  ).toContain("client-token-recovery");
  expect(responses.slice(0, 2)).toEqual([
    { url: "/api/auth/session", status: 200 },
    { url: "/api/activity/query", status: 200 },
  ]);
  ctx.repo.db.prepare("UPDATE sessions SET csrf=?").run("rotated-test-token");
  expect(
    (await api.activityPage(query)).events.map((item) => item.id),
  ).toContain("client-token-recovery");
  expect(responses.slice(-3)).toEqual([
    { url: "/api/activity/query", status: 403 },
    { url: "/api/auth/session", status: 200 },
    { url: "/api/activity/query", status: 200 },
  ]);
  expect(
    (await api.exportActivity(query)).events.map((item) => item.id),
  ).toContain("client-token-recovery");
  expect((await request("POST", "/api/activity/query", query)).statusCode).toBe(
    403,
  );
});
it("queries all selected-week records beyond 500 with identical filtered totals and detail pages", async () => {
  ctx.repo.transaction(() => {
    for (let i = 0; i < 725; i++)
      ctx.repo.audit("team", event(`old-${String(i).padStart(4, "0")}`));
    for (let i = 0; i < 650; i++)
      ctx.repo.audit(
        "team",
        event(`recent-${i}`, "2021-01-01T00:00:00.000Z", "project-2"),
      );
    ctx.repo.audit("other", event("foreign"));
  });
  expect(ctx.repo.snapshot("team").activities).toHaveLength(500);
  let result = await page({
    weekStart: "2020-10-05",
    projectIds: ["project-1"],
    excludeSeed: true,
    limit: 100,
  });
  expect(result).toMatchObject({
    total: 725,
    projectCount: 1,
    completionActions: 0,
    timeZone: "UTC",
  });
  expect(result.days.map((d) => d.count)).toEqual([0, 0, 725, 0, 0, 0, 0]);
  const ids = result.events.map((a) => a.id);
  while (result.nextCursor) {
    result = await page({
      weekStart: "2020-10-05",
      projectIds: ["project-1"],
      excludeSeed: true,
      limit: 100,
      cursor: result.nextCursor,
    });
    ids.push(...result.events.map((a) => a.id));
    expect(result.total).toBe(725);
  }
  expect(new Set(ids).size).toBe(725);
  expect((await page({ weekStart: "2020-10-05", projectIds: [] })).total).toBe(
    0,
  );
  expect(
    (await page({ weekStart: "2020-10-05", search: "no match" })).total,
  ).toBe(0);
});
it("uses stable cursor cutoffs with tied timestamps and excludes later backdated inserts", async () => {
  for (const id of ["c", "a", "b"]) ctx.repo.audit("team", event(id));
  const query = { weekStart: "2020-10-05", limit: 1 };
  const first = await page(query);
  expect(first.events[0]!.id).toBe("a");
  ctx.repo.audit("team", event("aa"));
  const second = await page({ ...query, cursor: first.nextCursor! });
  expect(second.total).toBe(3);
  expect(second.events[0]!.id).toBe("b");
  const third = await page({ ...query, cursor: second.nextCursor! });
  expect(third.events[0]!.id).toBe("c");
  expect(third.nextCursor).toBeNull();
  expect((await page(query)).total).toBe(4);
  expect(
    (
      await request("POST", "/api/activity/query", {
        ...query,
        projectIds: [],
        cursor: first.nextCursor,
      })
    ).statusCode,
  ).toBe(400);
});
it("normalizes timezone offsets, excludes next week and future events, and keeps completion semantics shared", async () => {
  const task = ctx.repo.snapshot("team").tasks.find((t) => t.parentId)!;
  const records = [
    event("previous", "2020-10-04T23:59:59.999Z"),
    event("start", "2020-10-05T02:00:00+02:00"),
    event("last", "2020-10-12T00:59:59.999+01:00"),
    event("next", "2020-10-12T00:00:00Z"),
    event("future", "2099-01-01T00:00:00Z"),
  ];
  const completion: Activity = {
    ...event("completion"),
    kind: "task",
    entityId: task.id,
    projectId: task.projectId,
    before: { ...task, status: "todo", version: 1 },
    after: { ...task, status: "done", version: 2 },
  };
  records.push(
    completion,
    { ...completion, id: "same-transition" },
    { ...completion, id: "restored", source: "History restore" },
  );
  for (const e of records) ctx.repo.audit("team", e);
  const query = { weekStart: "2020-10-05", excludeSeed: true };
  const result = await page(query);
  expect(result.total).toBe(5);
  expect(result.completionActions).toBe(1);
  expect(result.days.map((d) => d.count)).toEqual([1, 0, 3, 0, 0, 0, 1]);
  const local = queryActivities(
    records.sort(compareActivities),
    query,
    result.checkpoint.through,
    new Date(result.asOf),
  );
  expect({ ...result, nextCursor: null }).toEqual(local);
});
it("protects history queries and old exact links with workspace authentication and validates inputs", async () => {
  ctx.repo.audit("team", event("own"));
  ctx.repo.audit("other", event("other"));
  expect(
    (
      await ctx.app.inject({
        method: "POST",
        url: "/api/activity/query",
        payload: {},
      })
    ).statusCode,
  ).toBe(401);
  expect((await request("GET", "/api/activities/own")).json().id).toBe("own");
  expect((await request("GET", "/api/activities/other")).statusCode).toBe(404);
  for (const query of [
    { weekStart: "2020-10-06" },
    { weekStart: "2020-02-30" },
    { limit: 101 },
    { projectIds: "project-1" },
  ])
    expect(
      (await request("POST", "/api/activity/query", query)).statusCode,
    ).toBe(400);
});
it("provides a minimal same-workspace directory and never guesses identity from duplicate legacy names", async () => {
  const snapshot = (await request("GET", "/api/workspace")).json<Snapshot>();
  expect(snapshot.members).toHaveLength(2);
  expect(Object.keys(snapshot.members![0]!).sort()).toEqual([
    "email",
    "id",
    "name",
    "status",
  ]);
  const p = snapshot.projects[0]!;
  const saved = await request("PUT", `/api/projects/${p.id}`, {
    ...projectInput.strip().parse(p),
    owner: "Same Name",
    version: p.version,
  });
  expect(saved.statusCode).toBe(200);
  expect(saved.json().ownerId).toBeUndefined();
});
it("keeps stable owner, participant and task associations across rename and disable without changing historical names", async () => {
  const snapshot = ctx.repo.snapshot("team"),
    p = snapshot.projects[0]!,
    task = snapshot.tasks.find((t) => t.parentId)!;
  let response = await request("PUT", `/api/projects/${p.id}`, {
    ...projectInput.strip().parse(p),
    ownerId: members[0],
    participantIds: [members[1]],
    version: p.version,
  });
  expect(response.statusCode).toBe(200);
  let linked = response.json();
  const savedTask = (
    await request("PUT", `/api/tasks/${task.id}`, {
      ...taskInput.strip().parse(task),
      assigneeId: members[1],
      version: task.version,
    })
  ).json();
  expect(savedTask.assignee).toBe("Same Name");
  ctx.repo.db
    .prepare("UPDATE users SET name=?,status=? WHERE id=?")
    .run("Renamed person", "disabled", members[1]!);
  response = await request("PUT", `/api/projects/${p.id}`, {
    ...projectInput.strip().parse(linked),
    notes: "Still editable by the whole team",
    version: linked.version,
  });
  expect(response.statusCode).toBe(200);
  linked = response.json();
  const unchanged = (
    await request("PUT", `/api/tasks/${task.id}`, {
      ...taskInput.strip().parse(savedTask),
      description: "Preserve disabled assignment",
      version: savedTask.version,
    })
  ).json();
  expect(unchanged).toMatchObject({
    assigneeId: members[1],
    assignee: "Renamed person",
  });
  const oldEvent = ctx.repo
    .snapshot("team")
    .activities.find(
      (a) => a.entityId === task.id && a.after?.version === savedTask.version,
    )!;
  expect(oldEvent.after).toMatchObject({
    assignee: "Same Name",
    assigneeId: members[1],
  });
  expect(oldEvent.actorId).toBeTruthy();
  const other = snapshot.projects[1]!;
  expect(
    (
      await request("PUT", `/api/projects/${other.id}`, {
        ...projectInput.strip().parse(other),
        ownerId: members[1],
        version: other.version,
      })
    ).statusCode,
  ).toBe(400);
  const foreign = ctx.repo.members("other")[0]!.id;
  expect(
    (
      await request("PUT", `/api/projects/${other.id}`, {
        ...projectInput.strip().parse(other),
        participantIds: [foreign],
        version: other.version,
      })
    ).statusCode,
  ).toBe(400);
  expect(
    (
      await request("PUT", `/api/projects/${other.id}`, {
        ...projectInput.strip().parse(other),
        participantIds: [members[0], members[0]],
        version: other.version,
      })
    ).statusCode,
  ).toBe(400);
  const cleared = (
    await request("PUT", `/api/projects/${p.id}`, {
      ...projectInput.strip().parse(linked),
      ownerId: null,
      owner: "Unassigned",
      participantIds: [],
      version: linked.version,
    })
  ).json();
  expect(cleared).toMatchObject({
    ownerId: null,
    owner: "Unassigned",
    participantIds: [],
  });
});
it("retains assignments for older clients and same-workspace imports, rejecting foreign links atomically", async () => {
  const initial = ctx.repo.snapshot("team"),
    p = initial.projects[0]!;
  let current = (
    await request("PUT", `/api/projects/${p.id}`, {
      ...projectInput.strip().parse(p),
      ownerId: members[1],
      participantIds: [members[1]],
      version: p.version,
    })
  ).json();
  const legacy = projectInput.strip().parse(current);
  delete legacy.ownerId;
  delete legacy.participantIds;
  current = (
    await request("PUT", `/api/projects/${p.id}`, {
      ...legacy,
      notes: "Older client",
      version: current.version,
    })
  ).json();
  expect(current.ownerId).toBe(members[1]);
  expect(current.participantIds).toEqual([members[1]]);
  ctx.repo.db
    .prepare("UPDATE users SET status='disabled' WHERE id=?")
    .run(members[1]!);
  const snapshot = ctx.repo.snapshot("team");
  expect(
    (await request("POST", "/api/import", { ...snapshot, confirmed: true }))
      .statusCode,
  ).toBe(200);
  const before = ctx.repo.snapshot("team");
  const bad = structuredClone(before);
  bad.projects[0]!.ownerId = ctx.repo.members("other")[0]!.id;
  expect(
    (await request("POST", "/api/import", { ...bad, confirmed: true }))
      .statusCode,
  ).toBe(400);
  expect(ctx.repo.snapshot("team")).toEqual(before);
});
