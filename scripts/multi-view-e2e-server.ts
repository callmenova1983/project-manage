import {
  cpSync,
  existsSync,
  mkdirSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { resolve } from "node:path";
import { randomUUID } from "node:crypto";
import { pathToFileURL } from "node:url";

const directory = process.env.PM_MULTI_VIEW_TEST_DIR;
if (!directory)
  throw new Error("An isolated temporary test directory is required.");
const root = resolve(directory);
// Never remove/reuse an existing database or mutate the ordinary e2e data folder.
const databasePath = resolve(root, "multi-view.sqlite");
if (existsSync(databasePath))
  throw new Error("Use a fresh isolated test directory for each run.");
mkdirSync(root, { recursive: true });
cpSync(resolve("dist/web"), resolve(root, "web"), { recursive: true });
cpSync(resolve("dist/server"), resolve(root, "server"), { recursive: true });
symlinkSync(resolve("node_modules"), resolve(root, "node_modules"), "dir");
const { buildApp } = (await import(
  pathToFileURL(resolve(root, "server/apps/api/src/app.js")).href
)) as typeof import("../apps/api/src/app.js");
const { createUser } = (await import(
  pathToFileURL(resolve(root, "server/apps/api/src/auth.js")).href
)) as typeof import("../apps/api/src/auth.js");
const port = Number(process.env.PM_MULTI_VIEW_E2E_PORT ?? 4189);
const origin = `http://127.0.0.1:${port}`;
const { app, repo } = await buildApp({
  databasePath,
  origin,
  staticPath: resolve(root, "web"),
});
const workspaceId = "multi-view-acceptance";
repo.seed(workspaceId);
const credentials = [];
for (let index = 0; index < 5; index++) {
  const credential = {
    email: `multi-view-${index}@example.test`,
    password: randomUUID() + randomUUID(),
  };
  await createUser(repo, {
    ...credential,
    name: `Collaborator ${index}`,
    workspaceId,
  });
  credentials.push(credential);
}
const initial = repo.snapshot(workspaceId);
const project = initial.projects.find((project) => project.id === "project-1")!;
repo.putProject(workspaceId, {
  ...project,
  name: "上海工厂项目",
  aliases: ["Atlas"],
  shortName: "上海工厂",
});
for (const id of ["task-1", "task-2"]) {
  const task = initial.tasks.find((task) => task.id === id)!;
  const member = repo
    .snapshot(workspaceId)
    .members!.find(
      (member) => member.email === credentials[id === "task-1" ? 0 : 1]!.email,
    )!;
  repo.putTask(
    workspaceId,
    { ...task, assigneeId: member.id, assignee: member.name },
    undefined,
    { preserveAssignment: true },
  );
}
for (const [id, start, end, milestone] of [
  ["task-3", "2026-10-19", "2026-10-21", false],
  ["task-4", "2026-10-22", "2026-10-22", true],
] as const) {
  const task = initial.tasks.find((task) => task.id === id)!;
  repo.putTask(
    workspaceId,
    {
      ...task,
      scheduleStart: start,
      scheduleEnd: end,
      milestone,
      dependencies:
        id === "task-4" ? [{ taskId: "task-3", type: "finish_to_start" }] : [],
    },
    undefined,
    { preserveAssignment: true },
  );
}
const longTask = initial.tasks.find((task) => task.id === "task-8")!;
repo.putTask(
  workspaceId,
  {
    ...longTask,
    title:
      "Long unassigned acceptance task: 检查设备接线与交付资料，核对多层标题在窄屏、键盘和深色模式下均可阅读。".repeat(
        2,
      ),
    assignee: "",
    assigneeId: null,
  },
  undefined,
  { preserveAssignment: true },
);
writeFileSync(resolve(root, "credentials.json"), JSON.stringify(credentials), {
  mode: 0o600,
});
writeFileSync(
  resolve(root, "snapshot.json"),
  JSON.stringify(repo.snapshot(workspaceId)),
  { mode: 0o600 },
);
await app.listen({ host: "127.0.0.1", port });
for (const signal of ["SIGINT", "SIGTERM"] as const)
  process.on(signal, () => void app.close().then(() => process.exit(0)));
