import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { randomBytes, randomUUID } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { buildApp } from "../../apps/api/src/app.js";
import { createUser } from "../../apps/api/src/auth.js";
import {
  projectInput,
  taskInput,
  statistics,
  type Project,
  type Task,
  type Snapshot,
} from "../../packages/domain/types.js";
let context: Awaited<ReturnType<typeof buildApp>>;
let cookie = "",
  csrf = "",
  dir = "",
  db = "",
  password = "";
const origin = "http://localhost:4173";
async function login(email = "first@example.test") {
  const r = await context.app.inject({
    method: "POST",
    url: "/api/auth/login",
    payload: { email, password },
    headers: { origin },
  });
  expect(r.statusCode).toBe(200);
  return {
    cookie: r.cookies[0]!.name + "=" + r.cookies[0]!.value,
    csrf: r.json().csrf as string,
  };
}
function request(
  method: "GET" | "POST" | "PUT",
  url: string,
  payload?: unknown,
  key = randomUUID(),
) {
  return context.app.inject({
    method,
    url,
    payload: payload as Record<string, unknown>,
    headers: { cookie, origin, "x-csrf-token": csrf, "idempotency-key": key },
  });
}
async function snapshot() {
  return (await request("GET", "/api/workspace")).json<Snapshot>();
}
beforeEach(async () => {
  dir = mkdtempSync(join(tmpdir(), "pm-test-"));
  db = join(dir, "db.sqlite");
  context = await buildApp({ databasePath: db, origin });
  context.repo.seed("team-a");
  password = randomBytes(24).toString("hex");
  await createUser(context.repo, {
    email: "first@example.test",
    name: "First Member",
    password,
    workspaceId: "team-a",
  });
  await createUser(context.repo, {
    email: "second@example.test",
    name: "Second Member",
    password,
    workspaceId: "team-a",
  });
  await createUser(context.repo, {
    email: "outside@example.test",
    name: "Outside Member",
    password,
    workspaceId: "team-b",
  });
  ({ cookie, csrf } = await login());
});
afterEach(async () => {
  await context.app.close();
  rmSync(dir, { recursive: true, force: true });
});
describe("authenticated workspace API", () => {
  it("rejects anonymous reads, invalid credentials, missing CSRF and foreign origin", async () => {
    expect((await context.app.inject("/api/workspace")).statusCode).toBe(401);
    expect(
      (
        await context.app.inject({
          method: "POST",
          url: "/api/auth/login",
          payload: { email: "first@example.test", password: "invalid" },
        })
      ).statusCode,
    ).toBe(401);
    expect(
      (
        await context.app.inject({
          method: "POST",
          url: "/api/projects",
          payload: {},
          headers: { cookie },
        })
      ).statusCode,
    ).toBe(403);
    expect(
      (
        await context.app.inject({
          method: "POST",
          url: "/api/projects",
          payload: {},
          headers: {
            cookie,
            origin: "https://evil.example",
            "x-csrf-token": csrf,
          },
        })
      ).statusCode,
    ).toBe(403);
  });
  it("supports all team members while isolating other workspaces", async () => {
    const p = (await snapshot()).projects[0]!;
    ({ cookie, csrf } = await login("second@example.test"));
    expect(
      (
        await request("PUT", `/api/projects/${p.id}`, {
          ...projectInput.strip().parse(p),
          name: "Shared edit",
          version: p.version,
        })
      ).statusCode,
    ).toBe(200);
    ({ cookie, csrf } = await login("outside@example.test"));
    expect((await snapshot()).projects).toHaveLength(0);
    expect((await request("GET", `/api/projects/${p.id}`)).statusCode).toBe(
      404,
    );
    expect(
      (
        await request("PUT", `/api/projects/${p.id}`, {
          ...projectInput.strip().parse(p),
          version: p.version,
        })
      ).statusCode,
    ).toBe(404);
  });
  it("saves, audits and persists across database reopen", async () => {
    const p = (await snapshot()).projects[0]!;
    expect(
      (
        await request("PUT", `/api/projects/${p.id}`, {
          ...projectInput.strip().parse(p),
          latestUpdate: "Persistent update",
          version: p.version,
        })
      ).statusCode,
    ).toBe(200);
    await context.app.close();
    context = await buildApp({ databasePath: db, origin });
    const s = await snapshot();
    expect(s.projects.find((x) => x.id === p.id)!.latestUpdate).toBe(
      "Persistent update",
    );
    expect(
      s.activities.some(
        (a) => a.actor === "First Member" && a.before?.id === p.id,
      ),
    ).toBe(true);
  });
  it("rejects stale versions and deduplicates retries", async () => {
    const p = (await snapshot()).projects[0]!;
    const key = randomUUID(),
      payload = {
        ...projectInput.strip().parse(p),
        name: "Renamed project",
        version: p.version,
      };
    const a = await request("PUT", `/api/projects/${p.id}`, payload, key),
      b = await request("PUT", `/api/projects/${p.id}`, payload, key);
    expect(a.json()).toEqual(b.json());
    expect(
      (await request("PUT", `/api/projects/${p.id}`, payload)).statusCode,
    ).toBe(409);
    expect(
      (
        await request(
          "PUT",
          `/api/projects/${p.id}`,
          { ...payload, name: "Different" },
          key,
        )
      ).statusCode,
    ).toBe(409);
    expect(
      (await snapshot()).activities.filter(
        (x) => x.action === "Updated project",
      ),
    ).toHaveLength(1);
  });
  it("validates fields, calendar dates, hierarchy and derived parent status", async () => {
    const s = await snapshot();
    const t = s.tasks.find((t) => t.parentId)!;
    expect(
      (
        await request("PUT", `/api/tasks/${t.id}`, {
          ...taskInput.strip().parse(t),
          dueDate: "2026-02-30",
          version: t.version,
        })
      ).statusCode,
    ).toBe(400);
    expect(
      (
        await request("PUT", `/api/tasks/${t.id}`, {
          ...taskInput.strip().parse(t),
          parentId: t.id,
          version: t.version,
        })
      ).statusCode,
    ).toBe(400);
    expect((await snapshot()).tasks.find((x) => x.id === t.id)!.version).toBe(
      t.version,
    );
    const parent = s.tasks.find((x) => x.id === t.parentId)!;
    expect(
      (
        await request("PUT", `/api/tasks/${parent.id}`, {
          ...taskInput.strip().parse(parent),
          status: "done",
          version: parent.version,
        })
      ).statusCode,
    ).toBe(400);
    expect(
      (
        await request("POST", "/api/projects", {
          ...projectInput.strip().parse(s.projects[0]),
          name: " ",
        })
      ).statusCode,
    ).toBe(400);
  });
  it("updates leaf statistics and filters from persisted data", async () => {
    const s = await snapshot(),
      t = s.tasks.find((t) => t.id === "task-1")!;
    expect(
      (
        await request("PUT", `/api/tasks/${t.id}`, {
          ...taskInput.strip().parse(t),
          status: "done",
          version: t.version,
        })
      ).statusCode,
    ).toBe(200);
    expect(statistics((await snapshot()).tasks).done).toBe(91);
    const result = (
      await request("GET", "/api/tasks?status=done&projectId=project-1")
    ).json<Task[]>();
    expect(result.some((x) => x.id === t.id)).toBe(true);
    expect(
      (
        await request("GET", "/api/projects?search=Atlas&stage=implementation")
      ).json<Project[]>(),
    ).toHaveLength(1);
  });
  it("imports atomically with explicit confirmation and revision checks", async () => {
    const s = await snapshot();
    expect(
      (await request("POST", "/api/import", { ...s, confirmed: false }))
        .statusCode,
    ).toBe(400);
    expect(
      (
        await request("POST", "/api/import", {
          ...s,
          revision: s.revision + 1,
          confirmed: true,
        })
      ).statusCode,
    ).toBe(409);
    const invalid = {
      ...s,
      tasks: [{ ...s.tasks[0]!, projectId: "missing" }],
      confirmed: true,
    };
    expect((await request("POST", "/api/import", invalid)).statusCode).toBe(
      400,
    );
    expect((await snapshot()).tasks).toHaveLength(s.tasks.length);
    const r = await request("POST", "/api/import", { ...s, confirmed: true });
    expect(r.statusCode).toBe(200);
    expect(statistics(r.json<Snapshot>().tasks).total).toBe(150);
  });
  it("keeps meeting suggestions reviewable, traceable and single-apply", async () => {
    const p = (await snapshot()).projects[0]!;
    const proposal = (
      await request("POST", "/api/proposals", {
        source: "Atlas: confirm scope\nUnknown team: schedule review",
      })
    ).json();
    expect(proposal.suggestions[1].selectedProjectId).toBe("");
    const suggestion = {
      id: proposal.suggestions[0].id,
      selectedProjectId: p.id,
      title: "Confirm scope",
      action: "update",
      status: "todo",
      confirmed: true,
      overwriteConfirmed: false,
      projectVersion: p.version,
    };
    expect(
      (
        await request("POST", `/api/proposals/${proposal.id}/apply`, {
          suggestions: [suggestion],
        })
      ).statusCode,
    ).toBe(400);
    suggestion.overwriteConfirmed = true;
    expect(
      (
        await request("POST", `/api/proposals/${proposal.id}/apply`, {
          suggestions: [suggestion],
        })
      ).statusCode,
    ).toBe(200);
    expect(
      (
        await request("POST", `/api/proposals/${proposal.id}/apply`, {
          suggestions: [suggestion],
        })
      ).statusCode,
    ).toBe(409);
    expect((await snapshot()).activities[0]!.source).toContain(
      "line 1: Atlas: confirm scope",
    );
  });
  it("restores a previous value without silently overwriting a newer version", async () => {
    const s = await snapshot(),
      p = s.projects[0]!;
    const edited = (
      await request("PUT", `/api/projects/${p.id}`, {
        ...projectInput.strip().parse(p),
        name: "Changed",
        version: p.version,
      })
    ).json<Project>();
    const event = (await snapshot()).activities.find(
      (a) => a.action === "Updated project",
    )!;
    expect(
      (
        await request("POST", `/api/activities/${event.id}/restore`, {
          version: p.version,
        })
      ).statusCode,
    ).toBe(409);
    expect(
      (
        await request("POST", `/api/activities/${event.id}/restore`, {
          version: edited.version,
        })
      ).json<Project>().name,
    ).toBe(p.name);
  });
});

describe("additional boundary checks", () => {
  it("revokes logout and rejects expired sessions", async () => {
    expect((await request("POST", "/api/auth/logout", {})).statusCode).toBe(
      200,
    );
    expect((await request("GET", "/api/workspace")).statusCode).toBe(401);
    ({ cookie, csrf } = await login());
    context.repo.db.prepare("UPDATE sessions SET expires_at=0").run();
    expect((await request("GET", "/api/workspace")).statusCode).toBe(401);
  });
  it("rolls back a pasted batch when any relationship is invalid", async () => {
    const s = await snapshot(),
      t = s.tasks.find(
        (t) => !t.parentId && !s.tasks.some((x) => x.parentId === t.id),
      )!;
    const result = await request("POST", "/api/tasks/batch", {
      tasks: [
        taskInput.strip().parse(t),
        { ...taskInput.strip().parse(t), parentId: "missing" },
      ],
    });
    expect(result.statusCode).toBe(400);
    const after = await snapshot();
    expect(after.tasks).toHaveLength(s.tasks.length);
    expect(after.activities).toHaveLength(s.activities.length);
  });
  it("does not apply ambiguous or unconfirmed suggestions", async () => {
    const p = (
      await request("POST", "/api/proposals", {
        source: "Atlas and Meridian: coordinate review",
      })
    ).json();
    expect(p.suggestions[0].candidates).toHaveLength(2);
    expect(
      (
        await request("POST", `/api/proposals/${p.id}/apply`, {
          suggestions: [
            {
              id: p.suggestions[0].id,
              selectedProjectId: "project-1",
              title: "Review",
              action: "task",
              status: "todo",
              confirmed: false,
              overwriteConfirmed: false,
            },
          ],
        })
      ).statusCode,
    ).toBe(400);
    expect((await snapshot()).tasks).toHaveLength(160);
  });
  it("migrates only once and leaves data intact", async () => {
    expect(
      context.repo.db.prepare("SELECT count(*) AS n FROM migrations").get()!.n,
    ).toBe(3);
    const s = await snapshot();
    await context.app.close();
    context = await buildApp({ databasePath: db, origin });
    expect(
      context.repo.db.prepare("SELECT count(*) AS n FROM migrations").get()!.n,
    ).toBe(3);
    expect((await snapshot()).tasks).toHaveLength(s.tasks.length);
  });
});

describe("review batch regression", () => {
  it("applies two reviewed updates to one project without a self-conflict or lost text", async () => {
    const p = (await snapshot()).projects[0]!;
    const proposal = (
      await request("POST", "/api/proposals", {
        source:
          "Atlas: design review completed\nAtlas: acceptance meeting booked",
      })
    ).json();
    const result = await request(
      "POST",
      `/api/proposals/${proposal.id}/apply`,
      {
        suggestions: proposal.suggestions.map(
          (s: { id: string; title: string }) => ({
            id: s.id,
            selectedProjectId: p.id,
            title: s.title,
            action: "update",
            status: "todo",
            confirmed: true,
            overwriteConfirmed: true,
            projectVersion: p.version,
          }),
        ),
      },
    );
    expect(result.statusCode).toBe(200);
    const saved = (await snapshot()).projects.find((x) => x.id === p.id)!;
    expect(saved.latestUpdate).toContain("design review completed");
    expect(saved.latestUpdate).toContain("acceptance meeting booked");
    expect(saved.version).toBe(p.version + 1);
  });
});

describe("reported facts and exact provenance", () => {
  it("keeps report metadata on ordinary edits and stamps actual reports", async () => {
    const p = (await snapshot()).projects[0]!;
    const edited = await request("PUT", "/api/projects/" + p.id, {
      ...projectInput.strip().parse(p),
      owner: "New owner",
      notes: "Working notes changed",
      version: p.version,
    });
    expect(edited.statusCode).toBe(200);
    expect(edited.json()).toMatchObject({
      reportedAt: p.reportedAt,
      reportedBy: p.reportedBy,
    });
    const next = edited.json<Project>();
    const reported = await request("PUT", "/api/projects/" + p.id, {
      ...projectInput.strip().parse(next),
      latestUpdate: "Acceptance completed",
      version: next.version,
    });
    expect(reported.statusCode).toBe(200);
    expect(reported.json()).toMatchObject({
      reportedBy: "First Member",
      latestUpdate: "Acceptance completed",
    });
    expect(Date.parse(reported.json().reportedAt)).toBeGreaterThanOrEqual(
      Date.parse(p.reportedAt!),
    );
  });
  it("retains leading blank lines, indentation, TSV, Unicode and trailing spaces", async () => {
    const source = "\n\n  Atlas:\t完成验收 ✓  \r\n\tMeridian: review\n  ";
    const response = await request("POST", "/api/proposals", { source });
    expect(response.statusCode).toBe(200);
    const proposal = response.json();
    expect(proposal.source).toBe(source);
    expect(proposal.suggestions[0]).toMatchObject({
      sourceLine: 3,
      sourceText: "  Atlas:\t完成验收 ✓  ",
    });
    expect(proposal.suggestions[1]).toMatchObject({
      sourceLine: 4,
      sourceText: "\tMeridian: review",
    });
    const stored = JSON.parse(
      String(
        context.repo.db
          .prepare("SELECT data FROM proposals WHERE id=?")
          .get(proposal.id)!.data,
      ),
    );
    expect(stored.source).toBe(source);
  });
  it("requires date source, version and overwrite confirmation and audits neighboring lines", async () => {
    const s = await snapshot(),
      p = s.projects[0]!,
      t = s.tasks.find((t) => t.id === "task-1")!;
    const body = {
      projectVersion: p.version,
      sourceLine: 4,
      taskId: t.id,
      taskVersion: t.version,
      dueDate: "2027-02-01",
      confirmed: true,
      overwriteConfirmed: false,
    };
    const url = "/api/projects/" + p.id + "/note-dates";
    expect(
      (await request("POST", url, { ...body, sourceLine: 99 })).statusCode,
    ).toBe(400);
    expect((await request("POST", url, body)).statusCode).toBe(400);
    const applied = await request("POST", url, {
      ...body,
      overwriteConfirmed: true,
    });
    expect(applied.statusCode).toBe(200);
    expect(applied.json().dueDate).toBe("2027-02-01");
    const after = await snapshot();
    expect(after.projects.find((x) => x.id === p.id)).toEqual(p);
    expect(after.activities[0]!.source).toContain(
      "Acceptance checklist follows",
    );
    expect(
      (await request("POST", url, { ...body, overwriteConfirmed: true }))
        .statusCode,
    ).toBe(409);
  });
});
