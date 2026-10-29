import { expect, it } from "vitest";
import { Repository } from "../../apps/api/src/database.js";
import { readDatabaseConfig } from "../../apps/api/src/database-config.js";
import { taskInput } from "../../packages/domain/types.js";

it("retains legacy task planning through PostgreSQL reconnection and old-form edits without rewriting unrelated records", async () => {
  const owner = await Repository.open(readDatabaseConfig(), { isolated: true });
  const config = { ...readDatabaseConfig(), schema: owner.db.schema };
  let reopened: Repository | undefined;
  try {
    await owner.seed("synthetic");
    const initial = await owner.snapshot("synthetic");
    const leaves = initial.tasks.filter(
      (task) => !initial.tasks.some((child) => child.parentId === task.id),
    );
    const task = leaves[0]!;
    const predecessor = leaves.find(
      (row) => row.projectId === task.projectId && row.id !== task.id,
    )!;
    const planning = {
      scheduleStart: "2027-01-01",
      scheduleEnd: "2027-01-01",
      milestone: true,
      dependencies: [
        { taskId: predecessor.id, type: "finish_to_start" as const },
      ],
    };
    await owner.transaction(async () => {
      await owner.putTask(
        "synthetic",
        { ...task, ...planning, version: task.version + 1 },
        undefined,
        { preserveAssignment: true },
      );
      await owner.validate("synthetic");
    });
    reopened = await Repository.open(config);
    const snapshot = await reopened.snapshot("synthetic");
    expect(snapshot.revision).toBe(initial.revision);
    expect(snapshot.activities).toEqual(initial.activities);
    const saved = snapshot.tasks.find((row) => row.id === task.id)!;
    expect(saved).toMatchObject(planning);
    const legacy = taskInput.strip().parse(saved);
    delete legacy.scheduleStart;
    delete legacy.scheduleEnd;
    delete legacy.milestone;
    delete legacy.dependencies;
    await reopened.transaction(async () => {
      await reopened!.putTask(
        "synthetic",
        {
          ...legacy,
          id: saved.id,
          title: "Synthetic title edit",
          version: saved.version + 1,
          updatedAt: new Date().toISOString(),
        },
        undefined,
        { preserveAssignment: true },
      );
      await reopened!.validate("synthetic");
    });
    expect(
      (await reopened.snapshot("synthetic")).tasks.find(
        (row) => row.id === task.id,
      ),
    ).toMatchObject({
      ...planning,
      dueDate: task.dueDate,
      workDates: task.workDates,
      workWeek: task.workWeek,
    });
    await reopened.close();
    reopened = await Repository.open(config);
    expect(
      (await reopened.snapshot("synthetic")).tasks.find(
        (row) => row.id === task.id,
      ),
    ).toMatchObject({ ...planning, title: "Synthetic title edit" });
  } finally {
    await reopened?.close();
    await owner.close();
  }
});
