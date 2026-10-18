import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { randomUUID } from "node:crypto";
import { buildApp } from "../../apps/api/src/app";
import { createUser } from "../../apps/api/src/auth";
import { progressHistory } from "../../packages/domain/progress";
import type {
  Project,
  Proposal,
  Suggestion,
  Task,
} from "../../packages/domain/types";

let context: Awaited<ReturnType<typeof buildApp>>;
let cookie: string;
let csrf: string;
let project: Project;
const origin = "http://localhost:4173";
const workspaceId = "daily-report-tests";
const password = "synthetic-daily-report-password";
const actorName = "录入测试员";
const reporterName = "林甲";
const otherReporterName = "陈乙";
const explicitAssignee = "周丙";
const recipientName = "魏主管";

const request = (url: string, payload: unknown, key = randomUUID()) =>
  context.app.inject({
    method: "POST",
    url,
    payload: payload as Record<string, unknown>,
    headers: { origin, cookie, "x-csrf-token": csrf, "idempotency-key": key },
  });

async function addUser(name: string, email = `${randomUUID()}@example.test`) {
  await createUser(context.repo, { name, email, password, workspaceId });
  return context.repo
    .members(workspaceId)
    .find((member) => member.email === email)!;
}

async function propose(source: string) {
  const response = await request("/api/proposals", { source });
  expect(response.statusCode, response.body).toBe(200);
  return response.json<Proposal>();
}

function review(
  suggestion: Suggestion,
  overrides: Record<string, unknown> = {},
) {
  return {
    id: suggestion.id,
    selectedProjectId: project.id,
    title: suggestion.title,
    action: suggestion.action,
    status: suggestion.status,
    confirmed: true,
    overwriteConfirmed: false,
    ...overrides,
  };
}

function report(lines: string, reporter = reporterName, date = "2026-10-16") {
  return `${reporter}\nReport to:${recipientName}\n${date ? `日期：${date}\n` : ""}* 今日工作总结\n${lines}`;
}

function apply(proposal: Proposal, key = randomUUID()) {
  return request(
    `/api/proposals/${proposal.id}/apply`,
    {
      updateMode: "append",
      suggestions: proposal.suggestions.map((suggestion) => review(suggestion)),
    },
    key,
  );
}

beforeEach(async () => {
  context = await buildApp({ databasePath: ":memory:", origin });
  context.repo.seed(workspaceId);
  const seed = context.repo.snapshot(workspaceId).projects[0]!;
  project = {
    ...seed,
    id: randomUUID(),
    name: "星河测试项目",
    shortName: "星河测试",
    aliases: ["星河测试"],
    latestUpdate: "",
    reportedAt: null,
    reportedBy: null,
  };
  context.repo.putProject(workspaceId, project);
  await addUser(actorName, "operator@example.test");
  const login = await context.app.inject({
    method: "POST",
    url: "/api/auth/login",
    headers: { origin },
    payload: { email: "operator@example.test", password },
  });
  cookie = `pm_session=${login.cookies[0]!.value}`;
  csrf = login.json().csrf;
});

afterEach(async () => {
  vi.restoreAllMocks();
  await context.app.close();
});

it("attributes reported work and future tasks to the reporter while auditing the real submitter, with idempotent replay", async () => {
  const member = await addUser(reporterName);
  await addUser(recipientName);
  const proposal = await propose(
    report("1. 星河测试设备巡查完成\n2. 星河测试下周预计更换电脑"),
  );
  expect(proposal.suggestions.map((suggestion) => suggestion.action)).toEqual([
    "update",
    "task",
  ]);
  const key = randomUUID();
  const response = await apply(proposal, key);
  expect(response.statusCode, response.body).toBe(200);
  const receipt = response.json<Proposal>();
  const snapshot = context.repo.snapshot(workspaceId, true);
  const taskResult = receipt.appliedResults!.find((result) => result.taskId)!;
  const task = snapshot.tasks.find((item) => item.id === taskResult.taskId)!;
  expect(taskResult.taskDisposition).toBe("created");
  expect(task).toMatchObject({
    assignee: reporterName,
    assigneeId: member.id,
    status: "todo",
    workWeek: "2026-10-19",
    workDates: [],
    dueDate: null,
  });
  expect(task.description).toContain("预计");
  expect(task.assignee).not.toBe(recipientName);
  expect(task.assignee).not.toBe(actorName);
  const updated = snapshot.projects.find((item) => item.id === project.id)!;
  expect(updated.reportedBy).toBe(reporterName);
  const history = progressHistory(updated, snapshot.activities);
  expect(history).toHaveLength(1);
  expect(history[0]).toMatchObject({
    author: reporterName,
    originalSource: {
      text: proposal.source,
      materialIds: [],
      workDate: "2026-10-16",
    },
  });
  const activity = snapshot.activities.find(
    (item) => item.id === history[0]!.id,
  )!;
  expect(activity.actor).toBe(actorName);
  expect(activity.actorId).toBe(
    context.repo
      .members(workspaceId)
      .find((member) => member.name === actorName)!.id,
  );
  const replay = await apply(proposal, key);
  expect(replay.statusCode).toBe(200);
  expect(replay.json()).toEqual(receipt);
  expect(context.repo.snapshot(workspaceId).revision).toBe(snapshot.revision);
  expect((await apply(proposal)).statusCode).toBe(409);
});

it("uses an explicitly named executor before the reporter and never takes Report to as executor", async () => {
  await addUser(reporterName);
  const executor = await addUser(explicitAssignee);
  await addUser(recipientName);
  const proposal = await propose(
    report(`1. 星河测试下周安排培训，由${explicitAssignee}负责`),
  );
  const response = await apply(proposal);
  expect(response.statusCode, response.body).toBe(200);
  const result = response
    .json<Proposal>()
    .appliedResults!.find((item) => item.taskId)!;
  expect(
    context.repo
      .snapshot(workspaceId)
      .tasks.find((task) => task.id === result.taskId),
  ).toMatchObject({
    assignee: explicitAssignee,
    assigneeId: executor.id,
  });
});

it("keeps the reported name without guessing a member identity when active names are duplicated or absent", async () => {
  await addUser(reporterName);
  await addUser(reporterName);
  const proposal = await propose(
    `${report("1. 星河测试下周更换测试终端")}\n\n${report("1. 星河测试下周培训", otherReporterName)}`,
  );
  const response = await apply(proposal);
  expect(response.statusCode, response.body).toBe(200);
  const snapshot = context.repo.snapshot(workspaceId);
  const tasks = response
    .json<Proposal>()
    .appliedResults!.map((result) =>
      snapshot.tasks.find((task) => task.id === result.taskId),
    );
  expect(tasks).toMatchObject([
    { assignee: reporterName, assigneeId: null },
    { assignee: otherReporterName, assigneeId: null },
  ]);
});

it("excludes disabled members from exact matching", async () => {
  const active = await addUser(reporterName);
  const disabled = await addUser(reporterName);
  context.repo.db
    .prepare("UPDATE users SET status='disabled' WHERE id=?")
    .run(disabled.id);
  const proposal = await propose(report("1. 星河测试下周复核设备清单"));
  const response = await apply(proposal);
  expect(response.statusCode, response.body).toBe(200);
  const result = response.json<Proposal>().appliedResults![0]!;
  expect(
    context.repo
      .snapshot(workspaceId)
      .tasks.find((task) => task.id === result.taskId)?.assigneeId,
  ).toBe(active.id);
});

it("preserves separate progress entries for different reporters and report dates on the same project", async () => {
  const proposal = await propose(
    [
      report("1. 星河测试现场排查完成"),
      report("1. 星河测试现场排查完成", otherReporterName),
      report("1. 星河测试已完成补充复核", reporterName, "2026-10-17"),
    ].join("\n\n"),
  );
  const response = await apply(proposal);
  expect(response.statusCode, response.body).toBe(200);
  const snapshot = context.repo.snapshot(workspaceId, true);
  const updated = snapshot.projects.find((item) => item.id === project.id)!;
  expect(updated.version).toBe(project.version + 3);
  const history = progressHistory(updated, snapshot.activities);
  expect(history).toHaveLength(3);
  expect(
    history.map((entry) => [entry.author, entry.originalSource?.workDate]),
  ).toEqual(
    expect.arrayContaining([
      [reporterName, "2026-10-16"],
      [otherReporterName, "2026-10-16"],
      [reporterName, "2026-10-17"],
    ]),
  );
  const events = snapshot.activities.filter(
    (item) => item.action === "Added daily work log",
  );
  expect(events.every((item) => item.actor === actorName)).toBe(true);
  expect(
    events.map((item) => [
      (item.before as Project).version,
      (item.after as Project).version,
    ]),
  ).toEqual(
    expect.arrayContaining([
      [project.version, project.version + 1],
      [project.version + 1, project.version + 2],
      [project.version + 2, project.version + 3],
    ]),
  );
});

it("links an exact existing project/title/assignee task without changing its status, assignment, or schedule", async () => {
  const member = await addUser(reporterName);
  const proposal = await propose(report("1. 星河测试下周复核设备清单"));
  const existing: Task = {
    id: randomUUID(),
    projectId: project.id,
    parentId: null,
    title: proposal.suggestions[0]!.title,
    description: "Original task description",
    status: "in_progress",
    assignee: reporterName,
    assigneeId: member.id,
    dueDate: "2026-10-29",
    workWeek: "2026-10-19",
    workDates: ["2026-10-22"],
    version: 4,
    updatedAt: "2026-10-15T08:00:00.000Z",
  };
  context.repo.putTask(workspaceId, existing);
  const before = context.repo.snapshot(workspaceId);
  const response = await apply(proposal);
  expect(response.statusCode, response.body).toBe(200);
  expect(response.json<Proposal>().appliedResults).toEqual([
    {
      suggestionId: proposal.suggestions[0]!.id,
      projectId: project.id,
      taskId: existing.id,
      taskDisposition: "linked",
    },
  ]);
  const after = context.repo.snapshot(workspaceId);
  expect(after.tasks).toEqual(before.tasks);
  const next = await propose(
    report("1. 星河测试下周复核设备清单", otherReporterName),
  );
  expect((await apply(next)).statusCode).toBe(200);
  expect(context.repo.snapshot(workspaceId).tasks.length).toBe(
    before.tasks.length + 1,
  );
});

it("derives an omitted report date from proposal creation in the workspace time zone and persists it", async () => {
  context.repo.db
    .prepare("UPDATE workspaces SET time_zone=? WHERE id=?")
    .run("Asia/Shanghai", workspaceId);
  const proposal = await propose(
    report("1. 星河测试下周培训", reporterName, ""),
  );
  proposal.createdAt = "2026-10-18T16:30:00.000Z";
  context.repo.db
    .prepare("UPDATE proposals SET data=? WHERE id=?")
    .run(JSON.stringify(proposal), proposal.id);
  const response = await apply(proposal);
  expect(response.statusCode, response.body).toBe(200);
  const receipt = response.json<Proposal>();
  expect(receipt.suggestions[0]!.workDate).toBe("2026-10-19");
  const task = context.repo
    .snapshot(workspaceId)
    .tasks.find((item) => item.id === receipt.appliedResults![0]!.taskId)!;
  expect(task.workWeek).toBe("2026-10-26");
  expect(task.workDates).toEqual([]);
  expect(task.dueDate).toBeNull();
});

it.each([
  "done",
  "voided",
  "different-week",
  "parent",
  "duplicate",
  "ambiguous-member",
] as const)(
  "does not reuse a %s task merely because its visible project/title/name match",
  async (reason) => {
    const member = await addUser(reporterName);
    const proposal = await propose(report("1. 星河测试下周培训"));
    const existing: Task = {
      id: randomUUID(),
      projectId: project.id,
      parentId: null,
      title: proposal.suggestions[0]!.title,
      description: "Existing synthetic task",
      status: reason === "done" ? "done" : "todo",
      assignee: reporterName,
      assigneeId: member.id,
      dueDate: null,
      workWeek: reason === "different-week" ? "2026-10-12" : "2026-10-19",
      workDates: [],
      version: 1,
      updatedAt: "2026-10-15T08:00:00.000Z",
      ...(reason === "voided"
        ? {
            voided: {
              at: "2026-10-15T08:00:00.000Z",
              actor: actorName,
              actorId: "synthetic-actor",
              reason: "Synthetic obsolete task",
              batchId: randomUUID(),
            },
          }
        : {}),
    };
    context.repo.putTask(workspaceId, existing);
    if (reason === "parent")
      context.repo.putTask(workspaceId, {
        ...existing,
        id: randomUUID(),
        parentId: existing.id,
        title: "Synthetic active child",
      });
    if (reason === "duplicate")
      context.repo.putTask(workspaceId, { ...existing, id: randomUUID() });
    if (reason === "ambiguous-member") await addUser(reporterName);
    const before = context.repo.snapshot(workspaceId);
    const response = await apply(proposal);
    expect(response.statusCode, response.body).toBe(200);
    const result = response.json<Proposal>().appliedResults![0]!;
    expect(result.taskDisposition).toBe("created");
    expect(result.taskId).not.toBe(existing.id);
    const after = context.repo.snapshot(workspaceId);
    expect(after.tasks).toHaveLength(before.tasks.length + 1);
    expect(after.tasks.find((task) => task.id === existing.id)).toEqual(
      before.tasks.find((task) => task.id === existing.id),
    );
  },
);

it("reuses the sole active follow-up when the same report is imported again for the same week", async () => {
  await addUser(reporterName);
  const source = report("1. 星河测试下周培训");
  const first = await propose(source);
  const firstResponse = await apply(first);
  expect(firstResponse.statusCode, firstResponse.body).toBe(200);
  const created = firstResponse.json<Proposal>().appliedResults![0]!;
  const before = context.repo.snapshot(workspaceId);
  const repeated = await propose(source);
  const response = await apply(repeated);
  expect(response.statusCode, response.body).toBe(200);
  expect(response.json<Proposal>().appliedResults![0]).toMatchObject({
    taskId: created.taskId,
    taskDisposition: "linked",
  });
  expect(context.repo.snapshot(workspaceId).tasks).toEqual(before.tasks);
});

it("preserves an invalid explicit report date without inventing a replacement date or relative work week", async () => {
  const proposal = await propose(
    report(
      "1. 星河测试巡查完成\n2. 星河测试下周培训",
      reporterName,
      "2026-02-30",
    ),
  );
  expect(
    proposal.suggestions.every((suggestion) => suggestion.invalidWorkDate),
  ).toBe(true);
  const response = await apply(proposal);
  expect(response.statusCode, response.body).toBe(200);
  const receipt = response.json<Proposal>();
  expect(receipt.suggestions.every((suggestion) => !suggestion.workDate)).toBe(
    true,
  );
  const snapshot = context.repo.snapshot(workspaceId, true);
  const taskResult = receipt.appliedResults!.find((result) => result.taskId)!;
  expect(
    snapshot.tasks.find((task) => task.id === taskResult.taskId),
  ).toMatchObject({
    workWeek: null,
    workDates: [],
    dueDate: null,
  });
  const updated = snapshot.projects.find((item) => item.id === project.id)!;
  const history = progressHistory(updated, snapshot.activities);
  expect(history[0]!.originalSource?.text).toContain("2026-02-30");
  expect(history[0]!.originalSource).not.toHaveProperty("workDate");
});

it("keeps complete selected source lines from a long report and explicitly labels unavoidable excerpts", async () => {
  const proposal = await propose(
    report(`1. 星河测试巡查完成\n2. 星河测试${"设备已完成".repeat(2600)}`),
  );
  expect(proposal.source.length).toBeGreaterThan(12000);
  const first = await request(`/api/proposals/${proposal.id}/apply`, {
    partial: true,
    updateMode: "append",
    suggestions: [review(proposal.suggestions[0]!)],
  });
  expect(first.statusCode, first.body).toBe(200);
  let snapshot = context.repo.snapshot(workspaceId, true);
  let updated = snapshot.projects.find((item) => item.id === project.id)!;
  let history = progressHistory(updated, snapshot.activities);
  expect(history[0]!.originalSource?.text).toBe(
    proposal.suggestions[0]!.sourceText,
  );
  const second = await request(`/api/proposals/${proposal.id}/apply`, {
    partial: true,
    updateMode: "append",
    suggestions: [review(proposal.suggestions[1]!)],
  });
  expect(second.statusCode, second.body).toBe(200);
  snapshot = context.repo.snapshot(workspaceId, true);
  updated = snapshot.projects.find((item) => item.id === project.id)!;
  history = progressHistory(updated, snapshot.activities);
  const excerpt = history.find(
    (entry) => entry.text === proposal.suggestions[1]!.title,
  )!.originalSource!.text;
  expect(excerpt.length).toBeLessThanOrEqual(12000);
  expect(excerpt).toContain("以下为节选");
  expect(excerpt).toContain(proposal.id);
  const stored = context.repo.db
    .prepare("SELECT data FROM proposals WHERE id=?")
    .get(proposal.id)!;
  expect((JSON.parse(String(stored.data)) as Proposal).source).toBe(
    proposal.source,
  );
});

it("rejects forged client attribution and rolls all changes back if a later report write fails", async () => {
  const proposal = await propose(
    report("1. 星河测试巡查完成\n2. 星河测试下周更换测试终端"),
  );
  const forged = await request(`/api/proposals/${proposal.id}/apply`, {
    updateMode: "append",
    suggestions: proposal.suggestions.map((suggestion) =>
      review(suggestion, { assignee: recipientName }),
    ),
  });
  expect(forged.statusCode).toBe(400);
  const before = context.repo.snapshot(workspaceId, true);
  vi.spyOn(context.repo, "putProject").mockImplementationOnce(() => {
    throw new Error("Synthetic report write failure");
  });
  expect((await apply(proposal)).statusCode).toBe(500);
  expect(context.repo.snapshot(workspaceId, true)).toEqual(before);
  vi.restoreAllMocks();
  expect((await apply(proposal)).statusCode).toBe(200);
});

it("preserves ordinary meeting attribution and receipt shape", async () => {
  const proposal = await propose("星河测试设备已到场\n星河测试后续安排联调");
  expect(
    proposal.suggestions.every((suggestion) => !suggestion.dailyReport),
  ).toBe(true);
  const response = await request(`/api/proposals/${proposal.id}/apply`, {
    updateMode: "append",
    suggestions: proposal.suggestions.map((suggestion, index) =>
      review(suggestion, {
        action: index === 0 ? "update" : "task",
        status: index === 0 ? "done" : "todo",
      }),
    ),
  });
  expect(response.statusCode, response.body).toBe(200);
  const snapshot = context.repo.snapshot(workspaceId);
  expect(
    snapshot.projects.find((item) => item.id === project.id)?.reportedBy,
  ).toBe(actorName);
  const result = response
    .json<Proposal>()
    .appliedResults!.find((item) => item.taskId)!;
  expect(result).not.toHaveProperty("taskDisposition");
  expect(
    snapshot.tasks.find((item) => item.id === result.taskId)?.assignee,
  ).toBe("Unassigned");
});
