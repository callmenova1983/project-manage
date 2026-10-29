import { expect, it } from "vitest";
import { buildApp } from "../../apps/api/src/app";
import { createUser } from "../../apps/api/src/auth";
import { storedProposal } from "../fixtures/proposals";
it("retains saved report attribution and history when applying a legacy pending draft", async () => {
  const origin = "http://localhost:4173";
  const { app, repo } = await buildApp({ isolatedDatabase: true, origin });
  try {
    await repo.seed("reports");
    await createUser(repo, {
      workspaceId: "reports",
      name: "录入员",
      email: "report@example.test",
      password: "Synthetic-Report@2026",
    });
    const login = await app.inject({
      method: "POST",
      url: "/api/auth/login",
      payload: {
        email: "report@example.test",
        password: "Synthetic-Report@2026",
      },
    });
    const project = (await repo.snapshot("reports")).projects[0]!;
    const before = await repo.snapshot("reports");
    const proposal = await storedProposal(
      repo,
      "reports",
      "李明：现场核对设备；后续复核",
      [
        {
          title: "现场核对设备",
          sourceText: "现场核对设备",
          action: "update",
          status: "in_progress",
          dailyReport: true,
          reporter: "李明",
          workDate: "2026-10-17",
          selectedProjectId: project.id,
        },
        {
          title: "后续复核",
          sourceText: "后续复核",
          action: "task",
          status: "todo",
          dailyReport: true,
          reporter: "李明",
          workDate: "2026-10-17",
          workWeek: "2026-10-19",
          selectedProjectId: project.id,
        },
      ],
    );
    const headers = {
      origin,
      cookie: `pm_session=${login.cookies[0]!.value}`,
      "x-csrf-token": login.json().csrf,
      "idempotency-key": crypto.randomUUID(),
    };
    const response = await app.inject({
      method: "POST",
      url: `/api/proposals/${proposal.id}/apply`,
      headers,
      payload: {
        updateMode: "append",
        suggestions: proposal.suggestions.map((item) => ({
          id: item.id,
          title: item.title,
          selectedProjectId: project.id,
          action: item.action,
          status: item.status,
          confirmed: true,
          overwriteConfirmed: false,
        })),
      },
    });
    expect(response.statusCode, response.body).toBe(200);
    const after = await repo.snapshot("reports", true);
    expect(
      after.projects.find((item) => item.id === project.id)?.reportedBy,
    ).toBe("李明");
    expect(
      after.tasks.find(
        (item) => !before.tasks.some((old) => old.id === item.id),
      ),
    ).toMatchObject({
      assignee: "李明",
      workWeek: "2026-10-19",
      dueDate: null,
    });
    expect(after.activities[0]!.actor).toBe("录入员");
    expect(
      (
        await app.inject({
          method: "POST",
          url: `/api/proposals/${proposal.id}/apply`,
          headers: { ...headers, "idempotency-key": crypto.randomUUID() },
          payload: { suggestions: [] },
        })
      ).statusCode,
    ).toBe(409);
  } finally {
    await app.close();
  }
});
