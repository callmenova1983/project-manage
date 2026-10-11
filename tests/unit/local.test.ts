import { beforeEach, afterEach, describe, it, expect, vi } from "vitest";
import { createLocalApi } from "../../apps/web/src/services/local";
import { projectInput, statistics } from "../../packages/domain/types";
const saved = new Map<string, string>();
beforeEach(() => {
  saved.clear();
  vi.stubGlobal("localStorage", {
    getItem: (k: string) => saved.get(k) ?? null,
    setItem: (k: string, v: string) => saved.set(k, v),
  });
});
afterEach(() => vi.unstubAllGlobals());
describe("browser-local adapter", () => {
  it("persists to browser storage and shares the leaf-task metric contract", async () => {
    const api = createLocalApi(),
      s = await api.snapshot(),
      p = s.projects[0]!;
    expect(statistics(s.tasks)).toMatchObject({ total: 150, done: 90 });
    await api.saveProject(
      { ...projectInput.strip().parse(p), notes: "Stored locally" },
      p.id,
      p.version,
    );
    expect((await createLocalApi().snapshot()).projects[0]!.notes).toBe(
      "Stored locally",
    );
  });
  it("rejects another-tab changes without overwriting the current data", async () => {
    const a = createLocalApi(),
      b = createLocalApi();
    const p = (await a.snapshot()).projects[0]!;
    await b.saveProject(
      { ...projectInput.strip().parse(p), name: "Newer edit" },
      p.id,
      p.version,
    );
    await expect(
      a.saveProject(projectInput.strip().parse(p), p.id, p.version),
    ).rejects.toMatchObject({ status: 409 });
    expect((await b.snapshot()).projects[0]!.name).toBe("Newer edit");
  });
  it("does not silently reset corrupt browser storage", async () => {
    saved.set("project-manage-demo-v1", "bad JSON");
    await expect(createLocalApi().snapshot()).rejects.toThrow(
      "Local demo data is invalid",
    );
    expect(saved.get("project-manage-demo-v1")).toBe("bad JSON");
  });
});

it("combines same-project reviewed updates and preserves report time for notes edits", async () => {
  const api = createLocalApi(),
    p = (await api.snapshot()).projects[0]!;
  const changed = await api.saveProject(
    { ...projectInput.strip().parse(p), notes: "\n  Table\tOwner ✓  " },
    p.id,
    p.version,
  );
  expect(changed.reportedAt).toBe(p.reportedAt);
  const proposal = await api.propose(
    "\n  Atlas: scope done\nAtlas: acceptance ready",
  );
  const result = await api.applyProposal(
    proposal,
    proposal.suggestions.map((s) => ({
      ...s,
      action: "update",
      confirmed: true,
      overwriteConfirmed: true,
      projectVersion: changed.version,
    })),
  );
  expect(result.status).toBe("applied");
  const updated = (await api.snapshot()).projects[0]!;
  expect(updated.latestUpdate).toContain("scope done");
  expect(updated.latestUpdate).toContain("acceptance ready");
  expect(updated.version).toBe(changed.version + 1);
  expect(updated.reportedBy).toBe("Local demo");
});
it("rolls back a batch when a later reviewed project has a stale version", async () => {
  const api = createLocalApi(),
    s = await api.snapshot(),
    p = s.projects[0]!;
  const proposal = await api.propose("Atlas: first\nMeridian: second");
  await expect(
    api.applyProposal(
      proposal,
      proposal.suggestions.map((x, i) => ({
        ...x,
        action: "update",
        confirmed: true,
        overwriteConfirmed: true,
        projectVersion: i ? 99 : p.version,
      })),
    ),
  ).rejects.toMatchObject({ status: 409 });
  expect((await api.snapshot()).projects).toEqual(s.projects);
});

it("never enables Qwen or sends notes from the browser-local adapter", async () => {
  const api = createLocalApi();
  const outbound = vi.fn();
  vi.stubGlobal("fetch", outbound);
  expect(await api.aiCapabilities()).toMatchObject({
    enabled: false,
    provider: "rules",
    model: null,
  });
  await expect(api.proposeQwen("synthetic source", true)).rejects.toThrow(
    "browser-only demo",
  );
  expect(outbound).not.toHaveBeenCalled();
});

it("records history restoration distinctly from newly completed work", async () => {
  const { taskInput } = await import("../../packages/domain/types");
  const { isCompletionAction } =
    await import("../../apps/web/src/composables/activity-summary");
  const api = createLocalApi();
  const seed = await api.snapshot();
  const original = seed.tasks.find(
    (task) =>
      task.status === "done" &&
      !seed.tasks.some((child) => child.parentId === task.id),
  )!;
  const reopened = await api.saveTask(
    { ...taskInput.strip().parse(original), status: "todo" },
    original.id,
    original.version,
  );
  const afterEdit = await api.snapshot();
  const event = afterEdit.activities[0]!;
  await api.restore(event.id, reopened.version);
  const restored = await api.snapshot();
  expect(restored.activities).toHaveLength(afterEdit.activities.length + 1);
  expect(restored.activities[0]).toMatchObject({
    source: "History restore",
    action: "Restored previous version",
    before: { status: "todo" },
    after: { status: "done" },
  });
  expect(isCompletionAction(restored.activities[0]!)).toBe(false);
});

it("persists reviewed intake and undoes it after schema-normalized reload", async () => {
  const { intakeCandidates } = await import("../../packages/domain/intake");
  const api = createLocalApi(),
    before = await api.snapshot();
  const source = {
    kind: "text" as const,
    name: "notes",
    sheet: "",
    text: "Project: New intake; Client: Synthetic; Task: Review",
  };
  const batch = await api.applyIntake({
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
  });
  const reopened = createLocalApi();
  expect((await reopened.intakeHistory())[0]?.id).toBe(batch.id);
  await reopened.undoIntake(batch.id);
  expect((await reopened.snapshot()).projects).toEqual(before.projects);
  expect((await reopened.intakeHistory())[0]?.state).toBe("undone");
});

it("keeps demo administration local, persists user/catalog/model changes and never creates a real credential", async () => {
  const { defaultCatalogs } = await import("../../packages/domain/admin");
  const api = createLocalApi();
  const user = await api.saveUser({
    name: "Synthetic member",
    email: "member@example.test",
    role: "member",
  });
  expect(user.status).toBe("pending");
  expect(await api.userActivation(user.id)).toMatchObject({
    token: null,
    simulated: true,
  });
  const c = structuredClone(defaultCatalogs);
  c.categories.push({
    id: "design",
    en: "Design",
    zh: "设计",
    order: 0,
    color: "blue",
    archived: false,
  });
  await api.saveCatalogs(c);
  const model = await api.modelAdmin();
  await api.saveModel({ ...model.settings, timeoutMs: 10000 });
  const reopened = createLocalApi();
  expect(
    (await reopened.adminUsers()).find((u) => u.id === user.id)?.status,
  ).toBe("active");
  expect((await reopened.catalogs()).categories[0]?.id).toBe("design");
  expect((await reopened.modelAdmin()).settings.timeoutMs).toBe(10000);
  expect((await reopened.modelAdmin()).credentialAvailable).toBe(false);
  expect(
    (await reopened.modelLogs()).every((l) => l.mode === "simulated"),
  ).toBe(true);
  expect((await reopened.adminAudit()).length).toBeGreaterThanOrEqual(4);
});
