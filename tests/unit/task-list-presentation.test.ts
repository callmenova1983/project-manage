import { describe, expect, it } from "vitest";
import { defaultViewPreferences } from "../../apps/web/src/services/view-preferences";
import {
  readTaskListPresentation,
  taskListPresentationQuery,
} from "../../apps/web/src/services/task-list-presentation";
import {
  captureTaskView,
  savedTaskViewQuery,
  type SavedTaskView,
} from "../../apps/web/src/services/saved-task-views";
describe("shareable task list presentation", () => {
  it("gives URL display values precedence over personal defaults and supports no optional columns", () => {
    const defaults = {
      ...defaultViewPreferences(),
      taskGroup: "project" as const,
      taskSort: "updated" as const,
    };
    const read = readTaskListPresentation(
      { group: "assignee", sort: "due", density: "compact", columns: "" },
      defaults,
    );
    expect(read.error).toBe("");
    expect(read.value).toEqual({
      taskGroup: "assignee",
      taskSort: "due",
      density: "compact",
      taskColumns: [],
    });
    expect(readTaskListPresentation({}, defaults).value.taskGroup).toBe(
      "project",
    );
  });
  it("rejects repeated, unknown and duplicate display parameters without mutating defaults", () => {
    const defaults = defaultViewPreferences();
    const before = JSON.stringify(defaults);
    for (const query of [
      { group: ["none", "project"] },
      { columns: "status,status" },
      { columns: "secret" },
      { density: "tiny" },
      { sort: "unknown" },
    ]) {
      const result = readTaskListPresentation(query, defaults);
      expect(result.error).not.toBe("");
      expect(result.value.taskColumns).toEqual(defaults.taskColumns);
      expect(() => taskListPresentationQuery(result.value)).not.toThrow();
    }
    expect(JSON.stringify(defaults)).toBe(before);
  });
  it("captures and restores all display options with query overrides and reusable project templates", () => {
    const display = {
      taskGroup: "assignee" as const,
      taskSort: "due" as const,
      density: "compact" as const,
      taskColumns: ["status", "work"] as ("status" | "work")[],
    };
    expect(taskListPresentationQuery(display)).toEqual({
      group: "assignee",
      sort: "due",
      density: "compact",
      columns: "status,work",
    });
    const saved: SavedTaskView = {
      id: "saved",
      name: "My presentation",
      ...captureTaskView(
        "projectTasks",
        { scope: "all", project: "old-project", group: "status" },
        "list",
        false,
        display,
      ),
    };
    const query = savedTaskViewQuery(saved, { projects: [], members: [] });
    expect(query).not.toHaveProperty("project");
    expect(
      readTaskListPresentation(query, defaultViewPreferences()).value,
    ).toEqual({ ...display, taskGroup: "status" });
    expect(() =>
      captureTaskView(
        "tasks",
        { columns: "status,status" },
        "list",
        false,
        display,
      ),
    ).toThrow();
  });
});
