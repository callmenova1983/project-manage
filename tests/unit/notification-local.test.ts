import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { createLocalApi } from "../../apps/web/src/services/local";
import { safeNotificationPath } from "../../apps/web/src/services/contracts";
import { taskInput } from "../../packages/domain/types";

const storage = new Map<string, string>();
beforeEach(() => {
  storage.clear();
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-10-16T02:00:00.000Z"));
  vi.stubGlobal("localStorage", {
    getItem: (key: string) => storage.get(key) ?? null,
    setItem: (key: string, value: string) => storage.set(key, value),
  });
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});
async function assignedRisk() {
  const api = createLocalApi();
  const snapshot = await api.snapshot();
  const task = await api.saveTask({
    projectId: snapshot.projects[0]!.id,
    parentId: null,
    title: "Synthetic reminder task",
    status: "blocked",
    assignee: "Local demo",
    assigneeId: "local-demo",
    dueDate: "2026-10-15",
    reminderAt: "2026-10-16T01:00:00.000Z",
    description: "",
    workDates: [],
    workWeek: null,
  });
  const response = await api.notifications();
  return {
    api,
    task,
    item: response.items.find((item) => item.taskId === task.id)!,
  };
}
it("keeps one task reminder for overlapping risks and separates read from resolved", async () => {
  const { api, task, item } = await assignedRisk();
  expect(item.tags).toEqual(["overdue", "coordination", "reminder"]);
  expect(item.actionable).toBe(true);
  const before = await api.snapshot();
  const read = await api.notificationAction({ ids: [item.id], action: "read" });
  expect(read.items.find((current) => current.id === item.id)).toMatchObject({
    resolvedAt: null,
    readAt: "2026-10-16T02:00:00.000Z",
  });
  expect(read.pendingCount).toBeGreaterThan(0);
  expect(await api.snapshot()).toEqual(before);
  await api.saveTask(
    { ...taskInput.strip().parse(task), status: "done" },
    task.id,
    task.version,
  );
  const resolved = (await api.notifications()).items.find(
    (current) => current.id === item.id,
  )!;
  expect(resolved.resolvedAt).toBe("2026-10-16T02:00:00.000Z");
  expect(
    (await createLocalApi().notifications()).items.find(
      (current) => current.id === item.id,
    ),
  ).toEqual(resolved);
});
it("snoozes only the personal reminder and shows it again at the chosen instant", async () => {
  const { api, task, item } = await assignedRisk();
  const response = await api.notifications();
  const before = await api.snapshot();
  const snoozed = await api.notificationAction({
    ids: [item.id],
    action: "snooze",
    until: "2026-10-16T03:00:00.000Z",
  });
  expect(snoozed.pendingCount).toBe(response.pendingCount);
  expect(snoozed.unreadCount).toBe(response.unreadCount - 1);
  expect(await api.snapshot()).toEqual(before);
  vi.setSystemTime(new Date("2026-10-16T03:00:00.001Z"));
  expect((await createLocalApi().notifications()).unreadCount).toBe(
    response.unreadCount,
  );
  expect(
    (await api.snapshot()).tasks.find((current) => current.id === task.id),
  ).toEqual(task);
});
it("reopens a read reminder after snoozing and rejects handled or distant reminders", async () => {
  const { api, task, item } = await assignedRisk();
  await api.notificationAction({ ids: [item.id], action: "read" });
  const snoozed = await api.notificationAction({
    ids: [item.id],
    action: "snooze",
    until: "2026-10-16T03:00:00Z",
  });
  expect(snoozed.items.find((current) => current.id === item.id)).toMatchObject(
    {
      readAt: null,
      snoozedUntil: "2026-10-16T03:00:00.000Z",
    },
  );
  vi.setSystemTime(new Date("2026-10-16T03:00:00.001Z"));
  expect((await api.notifications()).unreadCount).toBe(snoozed.unreadCount + 1);
  await expect(
    api.notificationAction({
      ids: [item.id],
      action: "snooze",
      until: "2026-12-01T03:00:00Z",
    }),
  ).rejects.toMatchObject({ status: 400 });
  await api.saveTask(
    { ...taskInput.strip().parse(task), status: "done" },
    task.id,
    task.version,
  );
  await expect(
    api.notificationAction({
      ids: [item.id],
      action: "snooze",
      until: "2026-10-16T04:00:00Z",
    }),
  ).rejects.toMatchObject({ status: 409 });
});
it("persists account preferences with version conflicts and merges following without losing existing projects", async () => {
  const api = createLocalApi();
  const initial = await api.notifications();
  const projects = (await api.snapshot()).projects;
  await api.saveNotificationFollowing({
    projectIds: [projects[0]!.id],
    mode: "replace",
  });
  const merged = await createLocalApi().saveNotificationFollowing({
    projectIds: [projects[1]!.id],
    mode: "merge",
  });
  expect(merged.followingIds).toEqual([projects[0]!.id, projects[1]!.id]);
  const saved = await api.saveNotificationPreferences({
    ...initial.preferences,
    delivery: "digest",
    digestTime: "10:30",
  });
  expect(saved.preferences).toMatchObject({
    version: 2,
    delivery: "digest",
    digestTime: "10:30",
  });
  await expect(
    api.saveNotificationPreferences(initial.preferences),
  ).rejects.toMatchObject({ status: 409 });
  expect((await createLocalApi().notifications()).preferences).toEqual(
    saved.preferences,
  );
  expect(saved.deliveryStatus?.configured).toBe(false);
});
it("resolves a stable task message to its current project after a project merge", async () => {
  const { api, task, item } = await assignedRisk();
  const snapshot = await api.snapshot();
  const target = snapshot.projects.find(
    (project) => project.id !== task.projectId,
  )!;
  await api.mergeProjects({
    targetId: target.id,
    sourceIds: [task.projectId],
    name: target.name,
    revision: snapshot.revision,
    confirmed: true,
  });
  const path = (await api.openNotification(item.id)).path;
  expect(path).toBe(`/projects/${target.id}?task=${task.id}`);
  expect(
    (await api.notifications()).items.find((current) => current.id === item.id)
      ?.readAt,
  ).toBeNull();
});
it("accepts internal deep links and rejects external or slash-normalized URLs", () => {
  expect(safeNotificationPath("/projects/p?task=t#details")).toBe(
    "/projects/p?task=t#details",
  );
  for (const path of [
    "https://example.test",
    "//example.test",
    "/\\example.test",
    "javascript:alert(1)",
  ])
    expect(() => safeNotificationPath(path)).toThrow("提醒链接无效");
});
