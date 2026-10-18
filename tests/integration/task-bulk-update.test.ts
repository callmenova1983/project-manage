import { expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { buildApp } from "../../apps/api/src/app";
import { createUser } from "../../apps/api/src/auth";
it("applies existing-task bulk changes atomically, isolates foreign IDs and replays one audit batch", async () => {
  const origin = "http://localhost:4173",
    context = await buildApp({ databasePath: ":memory:", origin });
  try {
    context.repo.seed("team");
    await createUser(context.repo, {
      name: "Bulk member",
      email: "bulk@example.test",
      workspaceId: "team",
      password: "synthetic-bulk-password",
    });
    const login = await context.app.inject({
      method: "POST",
      url: "/api/auth/login",
      headers: { origin },
      payload: {
        email: "bulk@example.test",
        password: "synthetic-bulk-password",
      },
    });
    const headers = {
      origin,
      cookie: `pm_session=${login.cookies[0]!.value}`,
      "x-csrf-token": login.json().csrf,
    };
    const request = (payload: unknown, key = randomUUID()) =>
      context.app.inject({
        method: "POST",
        url: "/api/tasks/bulk-update",
        headers: { ...headers, "idempotency-key": key },
        payload: payload as Record<string, unknown>,
      });
    const initial = context.repo.snapshot("team");
    const leaves = initial.tasks
      .filter(
        (task) => !initial.tasks.some((child) => child.parentId === task.id),
      )
      .slice(0, 2);
    const targets = leaves.map((task) => ({
      id: task.id,
      version: task.version,
    }));
    const payload = { targets, change: { field: "status", value: "blocked" } };
    const denied = await context.app.inject({
      method: "POST",
      url: "/api/tasks/bulk-update",
      headers: {
        origin,
        cookie: headers.cookie,
        "idempotency-key": randomUUID(),
      },
      payload,
    });
    expect(denied.statusCode).toBe(403);
    const invalid = await request({
      ...payload,
      targets: [targets[0]!, { ...targets[1]!, version: 999 }],
    });
    expect(invalid.statusCode, invalid.body).toBe(409);
    expect(invalid.json().conflicts).toEqual([
      {
        id: targets[1]!.id,
        reason: "Task version changed.",
        currentVersion: targets[1]!.version,
      },
    ]);
    expect(context.repo.snapshot("team")).toEqual(initial);
    context.repo.seed("other");
    context.repo.putTask("other", {
      ...leaves[0]!,
      id: "foreign-only",
      title: "Secret foreign task",
    });
    const foreign = await request({
      ...payload,
      targets: [targets[0]!, { id: "foreign-only", version: 1 }],
    });
    expect(foreign.statusCode).toBe(409);
    expect(foreign.json().conflicts).toEqual([
      {
        id: "foreign-only",
        reason: "Task unavailable in this workspace.",
        currentVersion: null,
      },
    ]);
    expect(foreign.body).not.toContain("Secret foreign task");
    expect(context.repo.snapshot("team")).toEqual(initial);
    const key = randomUUID(),
      updated = await request(payload, key);
    expect(updated.statusCode, updated.body).toBe(200);
    const after = context.repo.snapshot("team");
    const audits = after.activities.filter(
      (event) => event.action === "Bulk updated task",
    );
    expect(audits).toHaveLength(2);
    expect(new Set(audits.map((event) => event.source)).size).toBe(1);
    expect((await request(payload, key)).json()).toEqual(updated.json());
    expect(context.repo.snapshot("team")).toEqual(after);
    const noop = await request({
      targets: updated.json().map((task: { id: string; version: number }) => ({
        id: task.id,
        version: task.version,
      })),
      change: payload.change,
    });
    expect(noop.statusCode).toBe(200);
    expect(context.repo.snapshot("team")).toEqual(after);
    const currentTargets = noop
      .json()
      .map((task: { id: string; version: number }) => ({
        id: task.id,
        version: task.version,
      }));
    const member = after.members!.find(
      (member) => member.email === "bulk@example.test",
    )!;
    const assigned = await request({
      targets: currentTargets,
      change: {
        field: "assignee",
        value: { assigneeId: member.id, assignee: "Old client label" },
      },
    });
    expect(assigned.statusCode, assigned.body).toBe(200);
    expect(
      assigned
        .json()
        .every(
          (task: { assigneeId: string; assignee: string }) =>
            task.assigneeId === member.id && task.assignee === member.name,
        ),
    ).toBe(true);
    const cleared = await request({
      targets: assigned
        .json()
        .map((task: { id: string; version: number }) => ({
          id: task.id,
          version: task.version,
        })),
      change: { field: "assignee", value: { assigneeId: null, assignee: "" } },
    });
    expect(cleared.statusCode, cleared.body).toBe(200);
    expect(
      cleared
        .json()
        .every(
          (task: { assigneeId: null; assignee: string }) =>
            task.assigneeId === null && task.assignee === "",
        ),
    ).toBe(true);
  } finally {
    await context.app.close();
  }
});
