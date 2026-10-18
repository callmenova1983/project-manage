import { describe, expect, it } from "vitest";
import { taskViewLink } from "../../apps/web/src/services/task-view-link";
import { defaultViewPreferences } from "../../apps/web/src/services/view-preferences";

describe("task view links", () => {
  it("includes private display defaults while preserving project sets and relative identity", () => {
    const prefs = {
      ...defaultViewPreferences(),
      taskGroup: "project" as const,
      density: "compact" as const,
    };
    const link = new URL(
      taskViewLink(
        "http://localhost/tasks?projects=a&projects=b&assignee=me#task-1",
        { projects: ["a", "b"], assignee: "me" },
        "board",
        prefs,
        { scope: "week", calendarMode: "month" },
      ),
    );
    expect(link.searchParams.getAll("projects")).toEqual(["a", "b"]);
    expect(link.searchParams.get("assignee")).toBe("me");
    expect(link.searchParams.get("scope")).toBe("week");
    expect(link.searchParams.get("group")).toBe("project");
    expect(link.searchParams.get("density")).toBe("compact");
    expect(link.searchParams.get("view")).toBe("board");
    expect(link.hash).toBe("#task-1");
  });
  it("uses the explicit URL presentation instead of private defaults, including hidden columns", () => {
    const link = new URL(
      taskViewLink(
        "http://localhost/tasks?group=none&columns=",
        { group: "none", columns: "" },
        "list",
        { ...defaultViewPreferences(), taskGroup: "project" },
        { scope: "all", calendarMode: "month" },
      ),
    );
    expect(link.searchParams.get("group")).toBe("none");
    expect(link.searchParams.get("columns")).toBe("");
  });
  it("preserves an empty project set and resolves the mobile calendar layout", () => {
    const link = new URL(
      taskViewLink(
        "http://localhost/tasks?projects=&q=abc",
        { projects: [""], q: "abc" },
        "calendar",
        defaultViewPreferences(),
        { scope: "all", calendarMode: "agenda" },
      ),
    );
    expect(link.searchParams.getAll("projects")).toEqual([""]);
    expect(link.searchParams.get("dateBasis")).toBe("due");
    expect(link.searchParams.get("calendarMode")).toBe("agenda");
    expect(link.searchParams.get("q")).toBe("abc");
  });
});
