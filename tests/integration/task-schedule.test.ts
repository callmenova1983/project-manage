import { expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { buildApp } from "../../apps/api/src/app";
import { createUser } from "../../apps/api/src/auth";
import { taskInput, type Task } from "../../packages/domain/types";
it("persists independent schedules, retains old-form omissions and rejects invalid graph writes atomically", async () => {
  const origin = "http://localhost:4173";
  const context = await buildApp({ databasePath: ":memory:", origin });
  try {
    context.repo.seed("team");
    await createUser(context.repo, {
      name: "Schedule member",
      email: "schedule@example.test",
      workspaceId: "team",
      password: "synthetic-schedule-password",
    });
    const login = await context.app.inject({
      method: "POST",
      url: "/api/auth/login",
      headers: { origin },
      payload: {
        email: "schedule@example.test",
        password: "synthetic-schedule-password",
      },
    });
    const headers = {
      origin,
      cookie: `pm_session=${login.cookies[0]!.value}`,
      "x-csrf-token": login.json().csrf,
    };
    const request = (
      method: "POST" | "PUT" | "PATCH",
      url: string,
      payload: unknown,
      key = randomUUID(),
    ) =>
      context.app.inject({
        method,
        url,
        headers: { ...headers, "idempotency-key": key },
        payload: payload as Record<string, unknown>,
      });
    const initial = context.repo.snapshot("team");
    const leaf = initial.tasks.find(
      (task) => !initial.tasks.some((child) => child.parentId === task.id),
    )!;
    const input = taskInput.strip().parse(leaf);
    const changed = await request("PUT", `/api/tasks/${leaf.id}`, {
      ...input,
      scheduleStart: "2026-12-28",
      scheduleEnd: "2027-01-10",
      milestone: false,
      version: leaf.version,
    });
    expect(changed.statusCode, changed.body).toBe(200);
    const scheduled = changed.json<Task>();
    expect(scheduled).toMatchObject({
      scheduleStart: "2026-12-28",
      scheduleEnd: "2027-01-10",
      dueDate: leaf.dueDate,
      workWeek: leaf.workWeek,
      workDates: leaf.workDates,
    });
    const oldForm = await request("PUT", `/api/tasks/${leaf.id}`, {
      ...input,
      title: "Old form title edit",
      version: scheduled.version,
    });
    expect(oldForm.statusCode, oldForm.body).toBe(200);
    let retained = oldForm.json<Task>();
    expect(retained.scheduleStart).toBe("2026-12-28");
    const legacy = context.repo
      .snapshot("team")
      .activities.find(
        (event) =>
          event.entityId === leaf.id &&
          event.after?.version === scheduled.version,
      )!;
    expect(legacy.before).not.toHaveProperty("scheduleStart");
    const restored = await request(
      "POST",
      `/api/activities/${legacy.id}/restore`,
      { version: retained.version },
    );
    expect(restored.statusCode, restored.body).toBe(200);
    retained = restored.json<Task>();
    expect(retained.scheduleStart).toBe("2026-12-28");
    const before = context.repo.snapshot("team");
    const invalid = await request("PUT", `/api/tasks/${leaf.id}`, {
      ...taskInput.strip().parse(retained),
      scheduleStart: null,
      version: retained.version,
    });
    expect(invalid.statusCode).toBe(400);
    const parent = await request("POST", "/api/tasks", {
      ...input,
      parentId: leaf.id,
      title: "A rejected child",
    });
    expect(parent.statusCode).toBe(400);
    const after = context.repo.snapshot("team");
    expect(after.revision).toBe(before.revision);
    expect(after.tasks).toEqual(before.tasks);
    expect(after.activities).toEqual(before.activities);
    const cleared = await request("PUT", `/api/tasks/${leaf.id}`, {
      ...taskInput.strip().parse(retained),
      scheduleStart: null,
      scheduleEnd: null,
      milestone: false,
      version: retained.version,
    });
    expect(cleared.statusCode, cleared.body).toBe(200);
    expect(cleared.json()).toMatchObject({
      scheduleStart: null,
      scheduleEnd: null,
      milestone: false,
    });
    const clearedTask = cleared.json<Task>();
    const member = context.repo
      .members("team")
      .find((member) => member.email === "schedule@example.test")!;
    const cached = {
      ...clearedTask,
      assigneeId: member.id,
      assignee: "Previously cached name",
    };
    context.repo.putTask("team", cached, undefined, {
      preserveAssignment: true,
    });
    const one = await request("PATCH", `/api/tasks/${leaf.id}/schedule`, {
      version: clearedTask.version,
      scheduleStart: "2027-02-01",
      scheduleEnd: "2027-02-02",
    });
    expect(one.statusCode, one.body).toBe(200);
    const single = one.json<Task>();
    expect(single.dueDate).toBe(leaf.dueDate);
    expect(single.assignee).toBe(cached.assignee);
    expect(single.assigneeId).toBe(member.id);
    const batchBefore = context.repo.snapshot("team");
    const other = batchBefore.tasks.find(
      (task) =>
        task.id !== leaf.id &&
        !batchBefore.tasks.some((child) => child.parentId === task.id),
    )!;
    const changes = [
      {
        id: single.id,
        version: single.version,
        scheduleStart: "2027-02-03",
        scheduleEnd: "2027-02-04",
      },
      {
        id: other.id,
        version: other.version,
        scheduleStart: "2027-02-05",
        scheduleEnd: "2027-02-05",
        milestone: true,
      },
    ];
    const conflict = await request("POST", "/api/tasks/schedule-batch", {
      revision: batchBefore.revision,
      changes: [changes[0], { ...changes[1]!, version: other.version + 99 }],
    });
    expect(conflict.statusCode).toBe(409);
    expect(context.repo.snapshot("team").tasks).toEqual(batchBefore.tasks);
    expect(context.repo.snapshot("team").revision).toBe(batchBefore.revision);
    const key = randomUUID(),
      batchInput = { revision: batchBefore.revision, changes };
    const batch = await request(
      "POST",
      "/api/tasks/schedule-batch",
      batchInput,
      key,
    );
    expect(batch.statusCode, batch.body).toBe(200);
    expect(batch.json<Task[]>()).toHaveLength(2);
    const confirmed = context.repo.snapshot("team");
    const replay = await request(
      "POST",
      "/api/tasks/schedule-batch",
      batchInput,
      key,
    );
    expect(replay.statusCode).toBe(200);
    expect(replay.json()).toEqual(batch.json());
    expect(context.repo.snapshot("team").revision).toBe(confirmed.revision);
    const latest = batch.json<Task[]>()[0]!;
    const staleRead = await request("POST", "/api/tasks/schedule-batch", {
      revision: batchBefore.revision,
      changes: [
        {
          id: latest.id,
          version: latest.version,
          milestone: latest.milestone ?? false,
        },
      ],
    });
    expect(staleRead.statusCode).toBe(409);
    const noop = await request("PATCH", `/api/tasks/${latest.id}/schedule`, {
      version: latest.version,
      scheduleStart: latest.scheduleStart,
      scheduleEnd: latest.scheduleEnd,
    });
    expect(noop.statusCode, noop.body).toBe(200);
    expect(noop.json().version).toBe(latest.version);
    expect(context.repo.snapshot("team").revision).toBe(confirmed.revision);
  } finally {
    await context.app.close();
  }
});
