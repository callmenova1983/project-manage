import { expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { buildApp } from "../../apps/api/src/app";
import { createUser } from "../../apps/api/src/auth";
import { taskInput, type Task } from "../../packages/domain/types";
import {
  taskDependencyWarnings,
  validateTaskDependencies,
} from "../../packages/domain/task-dependencies";
it("serializes opposing dependency writes, preserves date fields and rolls back invalid lifecycle changes", async () => {
  const origin = "http://localhost:4173",
    context = await buildApp({ databasePath: ":memory:", origin });
  try {
    context.repo.seed("team");
    await createUser(context.repo, {
      name: "Dependency member",
      email: "dependency@example.test",
      workspaceId: "team",
      password: "synthetic-dependency-password",
    });
    const login = await context.app.inject({
      method: "POST",
      url: "/api/auth/login",
      headers: { origin },
      payload: {
        email: "dependency@example.test",
        password: "synthetic-dependency-password",
      },
    });
    const headers = {
      origin,
      cookie: `pm_session=${login.cookies[0]!.value}`,
      "x-csrf-token": login.json().csrf,
    };
    const request = (method: "POST" | "PUT", url: string, payload: unknown) =>
      context.app.inject({
        method,
        url,
        headers: { ...headers, "idempotency-key": randomUUID() },
        payload: payload as Record<string, unknown>,
      });
    const initial = context.repo.snapshot("team"),
      projectId = initial.projects[0]!.id;
    const leaves = initial.tasks.filter(
      (task) =>
        task.projectId === projectId &&
        !initial.tasks.some((child) => child.parentId === task.id),
    );
    const [a, b] = leaves as [Task, Task];
    const edge = (taskId: string) => ({ taskId, type: "finish_to_start" });
    const results = await Promise.all([
      request("PUT", `/api/tasks/${a.id}/dependencies`, {
        version: a.version,
        dependencies: [edge(b.id)],
      }),
      request("PUT", `/api/tasks/${b.id}/dependencies`, {
        version: b.version,
        dependencies: [edge(a.id)],
      }),
    ]);
    expect(results.map((result) => result.statusCode).sort()).toEqual([
      200, 400,
    ]);
    const changed = results
      .find((result) => result.statusCode === 200)!
      .json<Task>();
    const original = initial.tasks.find((task) => task.id === changed.id)!;
    expect(changed).toMatchObject({
      dueDate: original.dueDate,
      workWeek: original.workWeek,
      workDates: original.workDates,
      status: original.status,
    });
    const before = context.repo.snapshot("team");
    expect(() => validateTaskDependencies(before.tasks)).not.toThrow();
    const noop = await request("PUT", `/api/tasks/${changed.id}/dependencies`, {
      version: changed.version,
      dependencies: changed.dependencies,
    });
    expect(noop.statusCode).toBe(200);
    expect(noop.json().version).toBe(changed.version);
    expect(context.repo.snapshot("team").revision).toBe(before.revision);
    const foreign = initial.tasks.find(
      (task) =>
        task.projectId !== projectId &&
        !initial.tasks.some((child) => child.parentId === task.id),
    )!;
    const invalid = await request(
      "PUT",
      `/api/tasks/${changed.id}/dependencies`,
      { version: changed.version, dependencies: [edge(foreign.id)] },
    );
    expect(invalid.statusCode).toBe(400);
    const child = await request("POST", "/api/tasks", {
      ...taskInput.strip().parse(original),
      parentId: changed.id,
      title: "Rejected child",
    });
    expect(child.statusCode).toBe(400);
    const moved = await request("PUT", `/api/tasks/${changed.id}`, {
      ...taskInput.strip().parse(changed),
      projectId: foreign.projectId,
      version: changed.version,
    });
    expect(moved.statusCode).toBe(400);
    expect(context.repo.snapshot("team").tasks).toEqual(before.tasks);
    expect(context.repo.snapshot("team").revision).toBe(before.revision);
    const predecessor = before.tasks.find(
      (task) => task.id === changed.dependencies![0]!.taskId,
    )!;
    const voided = await request(
      "POST",
      `/api/tasks/${predecessor.id}/lifecycle`,
      {
        version: predecessor.version,
        revision: before.revision,
        action: "void",
        reason: "Synthetic lifecycle check",
      },
    );
    expect(voided.statusCode, voided.body).toBe(200);
    const afterVoid = context.repo.snapshot("team");
    expect(
      taskDependencyWarnings(afterVoid.tasks).some(
        (warning) => warning.taskId === changed.id && warning.kind === "voided",
      ),
    ).toBe(true);
    const oldForm = taskInput.strip().parse(changed);
    delete oldForm.dependencies;
    const edit = await request("PUT", `/api/tasks/${changed.id}`, {
      ...oldForm,
      title: "Old form keeps dependencies",
      version: changed.version,
    });
    expect(edit.statusCode, edit.body).toBe(200);
    expect(edit.json<Task>().dependencies).toEqual(changed.dependencies);
    const unlinked = await request(
      "PUT",
      `/api/tasks/${changed.id}/dependencies`,
      { version: edit.json().version, dependencies: [] },
    );
    expect(unlinked.statusCode, unlinked.body).toBe(200);
    expect(unlinked.json<Task>().dependencies).toEqual([]);
  } finally {
    await context.app.close();
  }
});
