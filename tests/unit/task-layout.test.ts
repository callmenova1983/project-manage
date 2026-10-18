import { expect, it } from "vitest";
import {
  resolveTaskLayout,
  taskLayouts,
} from "../../apps/web/src/services/task-layout";
it("hides gantt when disabled and resolves old links/defaults without rewriting them", () => {
  const query = { view: "gantt", q: "synthetic", ganttDate: "2027-01-01" };
  const before = JSON.stringify(query);
  expect(taskLayouts(false)).not.toContain("gantt");
  expect(resolveTaskLayout(query.view, false)).toEqual({
    layout: "list",
    unavailable: true,
  });
  expect(resolveTaskLayout(query.view, true)).toEqual({
    layout: "gantt",
    unavailable: false,
  });
  expect(resolveTaskLayout("calendar", false)).toEqual({
    layout: "calendar",
    unavailable: false,
  });
  expect(resolveTaskLayout(["list", "gantt"], true)).toEqual({
    layout: "list",
    unavailable: true,
  });
  expect(JSON.stringify(query)).toBe(before);
});
