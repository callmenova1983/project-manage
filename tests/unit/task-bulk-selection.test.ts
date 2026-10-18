import { expect, it } from "vitest";
import { createSeed } from "../../packages/domain/seed";
import { selectBulkPage } from "../../apps/web/src/services/task-bulk-selection";
it("selects only the explicit page, preserves captured versions and rejects over-limit selection atomically", () => {
  const base = createSeed().tasks[0]!;
  const rows = Array.from({ length: 125 }, (_, i) => ({
    ...base,
    id: `synthetic-${i}`,
    version: 1,
  }));
  let selected = selectBulkPage([], rows.slice(0, 25));
  expect(selected).toHaveLength(25);
  expect(selected[0]).not.toBe(rows[0]);
  selected = selectBulkPage(selected, [{ ...rows[0]!, version: 2 }]);
  expect(selected[0]!.version).toBe(1);
  for (let page = 1; page < 4; page++)
    selected = selectBulkPage(selected, rows.slice(page * 25, (page + 1) * 25));
  const before = JSON.stringify(selected);
  expect(selected).toHaveLength(100);
  expect(() => selectBulkPage(selected, rows.slice(100))).toThrow(/100/);
  expect(JSON.stringify(selected)).toBe(before);
});
