import { it, expect, beforeEach, afterEach, vi } from "vitest";
import { createLocalApi } from "../../apps/web/src/services/local";
import { createSeed } from "../../packages/domain/seed";
import {
  projectInput,
  taskInput,
  type Member,
  type ProjectInput,
} from "../../packages/domain/types";
import {
  memberName,
  projectMembers,
  taskMember,
} from "../../packages/domain/members";
import { filterTaskWork } from "../../apps/web/src/composables/task-focus";
const records = new Map<string, string>();
beforeEach(() => {
  records.clear();
  vi.stubGlobal("localStorage", {
    getItem: (k: string) => records.get(k) ?? null,
    setItem: (k: string, v: string) => records.set(k, v),
  });
});
afterEach(() => vi.unstubAllGlobals());
const members: Member[] = [
  { id: "first", name: "Same", email: "first@example.test", status: "active" },
  {
    id: "second",
    name: "Same",
    email: "second@example.test",
    status: "active",
  },
];
it("does not auto-link matching names, preserves old clients, and permits explicit clearing", () => {
  const p = projectInput.strip().parse(createSeed().projects[0]);
  expect(
    projectMembers({ ...p, owner: "Same" }, members).ownerId,
  ).toBeUndefined();
  const linked = projectMembers(
    { ...p, ownerId: "first", participantIds: ["second"] },
    members,
  );
  const legacy: ProjectInput = { ...linked };
  delete legacy.ownerId;
  delete legacy.participantIds;
  expect(projectMembers(legacy, members, linked)).toMatchObject({
    ownerId: "first",
    participantIds: ["second"],
  });
  expect(
    projectMembers(
      { ...linked, ownerId: null, owner: "Unassigned", participantIds: [] },
      members,
      linked,
    ),
  ).toMatchObject({ ownerId: null, participantIds: [] });
  expect(
    projectMembers(
      { ...legacy, owner: "A text-only replacement" },
      members,
      linked,
    ).ownerId,
  ).toBeUndefined();
});
it("resolves current names for display and task search, retaining stored text when unresolved", () => {
  const renamed = members.map((m) => ({
    ...m,
    name: m.id === "first" ? "New name" : m.name,
  }));
  expect(memberName("first", "Old name", renamed)).toBe("New name");
  expect(memberName("unknown", "Original text", renamed)).toBe("Original text");
  const task = {
    ...createSeed().tasks.find((t) => t.parentId)!,
    assigneeId: "first",
    assignee: "Old name",
  };
  const filters = {
    scope: "all" as const,
    focus: "all" as const,
    status: "" as const,
    project: "",
    query: "New name",
  };
  expect(filterTaskWork([task], filters, new Date(), renamed)).toEqual([task]);
  expect(task.assignee).toBe("Old name");
  expect(taskMember(task, renamed, task).assignee).toBe("New name");
});
it("keeps local member links across reload, rejects unknown links, and uses the same full-history paging contract", async () => {
  const api = createLocalApi(),
    snapshot = await api.snapshot(),
    p = snapshot.projects[0]!,
    member = snapshot.members![1]!;
  const saved = await api.saveProject(
    {
      ...projectInput.strip().parse(p),
      ownerId: member.id,
      participantIds: [member.id],
    },
    p.id,
    p.version,
  );
  const task = snapshot.tasks.find((t) => t.parentId)!;
  await api.saveTask(
    { ...taskInput.strip().parse(task), assigneeId: member.id },
    task.id,
    task.version,
  );
  const reloaded = await createLocalApi().snapshot();
  expect(reloaded.projects.find((p) => p.id === saved.id)).toMatchObject({
    ownerId: member.id,
    participantIds: [member.id],
  });
  expect(reloaded.tasks.find((t) => t.id === task.id)?.assigneeId).toBe(
    member.id,
  );
  await expect(
    api.saveProject(
      { ...projectInput.strip().parse(saved), ownerId: "foreign" },
      saved.id,
      saved.version,
    ),
  ).rejects.toThrow("this workspace");
  expect((await api.snapshot()).revision).toBe(reloaded.revision);
  const first = await api.activityPage({ excludeSeed: true, limit: 1 });
  expect(first.total).toBe(2);
  expect(first.nextCursor).not.toBeNull();
  const second = await api.activityPage({
    excludeSeed: true,
    limit: 1,
    cursor: first.nextCursor!,
  });
  expect(second.total).toBe(2);
  expect(second.events[0]!.id).not.toBe(first.events[0]!.id);
  expect((await api.activity(first.events[0]!.id)).actorId).toBe("local-demo");
});
