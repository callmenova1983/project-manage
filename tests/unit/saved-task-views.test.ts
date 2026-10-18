import { describe, expect, it } from "vitest";
import {
  captureTaskView,
  readSavedTaskViews,
  savedTaskViewQuery,
  writeSavedTaskViews,
  type SavedTaskView,
} from "../../apps/web/src/services/saved-task-views";
import {
  readProjectTaskFilters,
  readTaskFilters,
} from "../../apps/web/src/composables/task-focus";
const available = { projects: ["a", "b"], members: ["m"] };
function view(id = "one"): SavedTaskView {
  return {
    id,
    name: "本周我的任务",
    ...captureTaskView(
      "tasks",
      { scope: "week", assignee: "me", focus: "open", date: "2026-10-16" },
      "calendar",
      false,
    ),
  };
}
function storage() {
  const values = new Map<string, string>();
  return {
    values,
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => {
      values.set(key, value);
    },
  };
}
describe("personal named task filters", () => {
  it("captures gantt scale and keeps its date relative unless explicitly pinned", () => {
    const query = { ganttDate: "2027-03-01", ganttScale: "week", scope: "all" };
    expect(captureTaskView("tasks", query, "gantt", false).query).toMatchObject(
      { view: "gantt", ganttScale: "week" },
    );
    expect(
      captureTaskView("tasks", query, "gantt", false).query,
    ).not.toHaveProperty("ganttDate");
    expect(captureTaskView("tasks", query, "gantt", true).query).toMatchObject({
      ganttDate: "2027-03-01",
      ganttScale: "week",
    });
  });
  it("stores rules without business results, keeps relative time and fixed dates distinct", () => {
    const relative = view();
    expect(relative.query).not.toHaveProperty("date");
    expect(relative.query.assignee).toBe("me");
    expect(relative.query.scope).toBe("week");
    const absolute = captureTaskView(
      "tasks",
      { date: "2026-10-16", scope: "today" },
      "calendar",
      true,
    );
    expect(absolute).toMatchObject({
      anchorMode: "absolute",
      query: { date: "2026-10-16", scope: "today" },
    });
    expect(() =>
      captureTaskView("tasks", { scope: ["all", "week"] }, "list", false),
    ).toThrow();
    expect(() =>
      captureTaskView("tasks", { assignee: "invalid" }, "list", false),
    ).toThrow();
  });
  it("removes project identities from templates and applies only to the current route project", () => {
    const template: SavedTaskView = {
      id: "template",
      name: "我的任务模板",
      ...captureTaskView(
        "projectTasks",
        { scope: "all", project: "a", projects: ["a"], assignee: "me" },
        "board",
        false,
      ),
    };
    expect(template.query).not.toHaveProperty("project");
    expect(template.query).not.toHaveProperty("projects");
    const query = savedTaskViewQuery(template, available);
    expect(readProjectTaskFilters(query, "b")).toMatchObject({
      project: "b",
      scope: "all",
      assignee: "me",
    });
  });
  it("rejects unavailable references and preserves an explicitly empty project set", () => {
    expect(() =>
      savedTaskViewQuery(
        { ...view(), query: { project: "deleted" } },
        available,
      ),
    ).toThrow("unavailable");
    expect(() =>
      savedTaskViewQuery(
        { ...view(), query: { assignee: "member:deleted" } },
        available,
      ),
    ).toThrow("unavailable");
    const query = savedTaskViewQuery(
      { ...view(), query: { projects: [] } },
      available,
    );
    expect(readTaskFilters(query).projects).toEqual([]);
  });
  it("round-trips rename, update, reorder and deletion within limits without replacing invalid storage", () => {
    const local = storage();
    const views = [view("one"), view("two")];
    expect(writeSavedTaskViews(local, "key", views)).toBe("");
    const updated = [
      { ...views[1]!, name: "新名字" },
      { ...views[0]!, query: { scope: "all" as const } },
    ];
    expect(writeSavedTaskViews(local, "key", updated)).toBe("");
    expect(readSavedTaskViews(local, "key").views).toEqual(updated);
    expect(writeSavedTaskViews(local, "key", updated.slice(1))).toBe("");
    expect(
      readSavedTaskViews(local, "key").views.map((value) => value.id),
    ).toEqual(["one"]);
    const before = local.values.get("key");
    for (const invalid of [
      Array.from({ length: 21 }, (_, i) => view(String(i))),
      [{ ...view(), name: " " }],
      [{ ...view(), name: "a".repeat(41) }],
      [view(), view()],
    ])
      expect(writeSavedTaskViews(local, "key", invalid)).not.toBe("");
    expect(local.values.get("key")).toBe(before);
    local.values.set("key", JSON.stringify({ version: 2, views: [] }));
    expect(readSavedTaskViews(local, "key").error).not.toBe("");
    expect(writeSavedTaskViews(local, "key", [])).not.toBe("");
    expect(local.values.get("key")).toContain('"version":2');
  });
  it("handles unavailable browser storage without a false save success", () => {
    const local = {
      getItem() {
        throw new Error("blocked");
      },
      setItem() {
        throw new Error("quota");
      },
    };
    expect(readSavedTaskViews(local, "key").error).not.toBe("");
    expect(writeSavedTaskViews(local, "key", [view()])).not.toBe("");
  });
});
