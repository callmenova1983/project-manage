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
