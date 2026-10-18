import { expect, it } from "vitest";
import { DatabaseSync } from "node:sqlite";
import { mkdtempSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Repository } from "../../apps/api/src/database";
import { backupDatabase } from "../../apps/api/src/backup";
import { createSeed } from "../../packages/domain/seed";
import { taskInput } from "../../packages/domain/types";

it("upgrades legacy task JSON without business writes and retains planning through restart, old-form edits and private backup", async () => {
  const dir = mkdtempSync(join(tmpdir(), "pm-planning-upgrade-")),
    path = join(dir, "legacy.sqlite");
  let old: DatabaseSync | undefined,
    repo: Repository | undefined,
    restored: Repository | undefined;
  try {
    old = new DatabaseSync(path);
    for (const file of readdirSync("apps/api/migrations")
      .filter(
        (file) =>
          /^\d+_.+\.sql$/.test(file) && Number(file.split("_")[0]) <= 18,
      )
      .sort()) {
      old.exec(readFileSync(join("apps/api/migrations", file), "utf8"));
      old
        .prepare(
          "INSERT OR IGNORE INTO migrations(version,applied_at) VALUES(?,?)",
        )
        .run(Number(file.split("_")[0]), "2026-10-01T00:00:00Z");
    }
    old
      .prepare("INSERT INTO workspaces(id,name) VALUES(?,?)")
      .run("synthetic", "Synthetic planning upgrade");
    const seed = createSeed(new Date("2026-10-01T12:00:00Z"));
    for (const project of seed.projects)
      old
        .prepare(
          "INSERT INTO projects(id,workspace_id,version,data) VALUES(?,?,?,?)",
        )
        .run(project.id, "synthetic", project.version, JSON.stringify(project));
    for (const task of seed.tasks)
      old
        .prepare(
          "INSERT INTO tasks(id,workspace_id,project_id,version,data) VALUES(?,?,?,?,?)",
        )
        .run(
          task.id,
          "synthetic",
          task.projectId,
          task.version,
          JSON.stringify(task),
        );
    for (const activity of seed.activities)
      old
        .prepare(
          "INSERT INTO activities(id,workspace_id,created_at,data) VALUES(?,?,?,?)",
        )
        .run(
          activity.id,
          "synthetic",
          activity.createdAt,
          JSON.stringify(activity),
        );
    const revision = Number(
      old
        .prepare("SELECT revision FROM workspaces WHERE id=?")
        .get("synthetic")!.revision,
    );
    old.close();
    old = undefined;
    repo = new Repository(path);
    const upgraded = repo.snapshot("synthetic");
    expect(upgraded.schemaVersion).toBe(3);
    expect(upgraded.revision).toBe(revision);
    expect(upgraded.activities).toHaveLength(seed.activities.length);
    for (const activity of seed.activities)
      expect(
        upgraded.activities.find((row) => row.id === activity.id),
      ).toMatchObject(activity);
    for (const task of seed.tasks)
      expect(upgraded.tasks.find((row) => row.id === task.id)).toMatchObject(
        task,
      );
    expect(
      upgraded.tasks.every(
        (task) =>
          task.dependencies === undefined && task.scheduleStart === undefined,
      ),
    ).toBe(true);
    const leaves = upgraded.tasks.filter(
      (task) => !upgraded.tasks.some((child) => child.parentId === task.id),
    );
    const task = leaves[0]!,
      predecessor = leaves.find(
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
    repo.transaction(() => {
      repo!.putTask(
        "synthetic",
        { ...task, ...planning, version: task.version + 1 },
        undefined,
        { preserveAssignment: true },
      );
      repo!.validate("synthetic");
    });
    repo.close();
    repo = new Repository(path);
    const saved = repo
      .snapshot("synthetic")
      .tasks.find((row) => row.id === task.id)!;
    expect(saved).toMatchObject(planning);
    const legacy = taskInput.strip().parse(saved);
    delete legacy.scheduleStart;
    delete legacy.scheduleEnd;
    delete legacy.milestone;
    delete legacy.dependencies;
    repo.transaction(() => {
      repo!.putTask(
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
      repo!.validate("synthetic");
    });
    expect(
      repo.snapshot("synthetic").tasks.find((row) => row.id === task.id),
    ).toMatchObject({
      ...planning,
      dueDate: task.dueDate,
      workDates: task.workDates,
      workWeek: task.workWeek,
    });
    const before = repo.snapshot("synthetic");
    const backup = join(dir, "private-backup.sqlite");
    await backupDatabase(path, backup);
    restored = new Repository(backup);
    expect(restored.snapshot("synthetic")).toEqual(before);
  } finally {
    old?.close();
    repo?.close();
    restored?.close();
    rmSync(dir, { recursive: true, force: true });
  }
});
