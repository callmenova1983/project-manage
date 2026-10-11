import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { randomUUID, randomBytes } from "node:crypto";
import { buildApp } from "../../apps/api/src/app";
import { createUser } from "../../apps/api/src/auth";
import {
  intakeCandidates,
  type IntakeInput,
  type IntakeSource,
} from "../../packages/domain/intake";
let context: Awaited<ReturnType<typeof buildApp>>,
  cookie = "",
  csrf = "";
const origin = "http://localhost:4173";
const source: IntakeSource = {
  kind: "text",
  name: "intake.txt",
  sheet: "",
  text: "Project: New intake; Client: Example; Task: First\nProject: New intake; Client: Example; Task: Second",
};
function input(): IntakeInput {
  return {
    source,
    confirmed: true,
    rows: intakeCandidates(source, []).map((c) => ({
      sourceRow: c.sourceRow,
      targetProjectId: "",
      targetProjectVersion: null,
      project: c.project,
      task: c.task,
      duplicateConfirmed: false,
    })),
  };
}
const request = (
  method: "GET" | "POST",
  url: string,
  payload?: unknown,
  key = randomUUID(),
) =>
  context.app.inject({
    method,
    url,
    payload: payload as Record<string, unknown>,
    headers: { origin, cookie, "x-csrf-token": csrf, "idempotency-key": key },
  });
beforeEach(async () => {
  context = await buildApp({ databasePath: ":memory:", origin });
  context.repo.seed("a");
  const password = randomBytes(24).toString("hex");
  await createUser(context.repo, {
    email: "intake@example.test",
    name: "Member",
    workspaceId: "a",
    password,
  });
  const login = await context.app.inject({
    method: "POST",
    url: "/api/auth/login",
    payload: { email: "intake@example.test", password },
    headers: { origin },
  });
  cookie = `pm_session=${login.cookies[0]!.value}`;
  csrf = login.json().csrf;
});
afterEach(async () => {
  await context.app.close();
});
describe("transactional reviewed intake", () => {
  it("creates one project and two tasks once, preserves source and can undo the batch", async () => {
    const key = randomUUID(),
      before = context.repo.snapshot("a");
    const a = await request("POST", "/api/intakes", input(), key);
    expect(a.statusCode).toBe(200);
    const batch = a.json();
    expect(batch.projects).toHaveLength(1);
    expect(batch.tasks).toHaveLength(2);
    expect(
      (await request("POST", "/api/intakes", input(), key)).json().id,
    ).toBe(batch.id);
    expect(context.repo.snapshot("a").projects).toHaveLength(
      before.projects.length + 1,
    );
    expect(context.repo.snapshot("a").activities[0]!.source).toContain("Row");
    expect((await request("GET", "/api/intakes")).json()).toHaveLength(1);
    expect(
      (
        await request("POST", `/api/intakes/${batch.id}/undo`, {
          confirmed: true,
        })
      ).statusCode,
    ).toBe(200);
    expect(context.repo.snapshot("a").tasks).toHaveLength(before.tasks.length);
    expect(context.repo.snapshot("a").projects).toHaveLength(
      before.projects.length,
    );
  });
  it("rolls back all writes on an invalid later row and rejects unconfirmed input", async () => {
    const before = context.repo.snapshot("a"),
      data = input();
    data.rows[1]!.project.owner = "Conflicting owner";
    expect((await request("POST", "/api/intakes", data)).statusCode).toBe(400);
    expect(context.repo.snapshot("a")).toEqual(before);
    expect(
      (await request("POST", "/api/intakes", { ...input(), confirmed: false }))
        .statusCode,
    ).toBe(400);
  });
  it("protects newer changes and workspace isolation during undo", async () => {
    const batch = (await request("POST", "/api/intakes", input())).json();
    const p = batch.projects[0];
    context.repo.putProject("a", { ...p, version: 2 });
    expect(
      (
        await request("POST", `/api/intakes/${batch.id}/undo`, {
          confirmed: true,
        })
      ).statusCode,
    ).toBe(400);
    expect(context.repo.snapshot("a").projects.some((x) => x.id === p.id)).toBe(
      true,
    );
    context.repo.workspace("b");
    context.repo.db.prepare("UPDATE users SET workspace_id='b'").run();
    expect((await request("GET", "/api/intakes")).json()).toEqual([]);
    expect(
      (
        await request("POST", `/api/intakes/${batch.id}/undo`, {
          confirmed: true,
        })
      ).statusCode,
    ).toBe(404);
  });
});
