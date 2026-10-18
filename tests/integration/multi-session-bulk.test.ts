import { expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { buildApp } from "../../apps/api/src/app";
import { createUser } from "../../apps/api/src/auth";
import type { Snapshot, Task } from "../../packages/domain/types";

it("keeps five independent sessions consistent while concurrent bulk edits conflict and replay safely", async () => {
  const origin = "http://localhost:4173",
    context = await buildApp({ databasePath: ":memory:", origin });
  try {
    context.repo.seed("team");
    const sessions: { cookie: string; csrf: string }[] = [];
    for (let i = 0; i < 5; i++) {
      const email = `collaborator-${i}@example.test`;
      await createUser(context.repo, {
        name: `Synthetic collaborator ${i}`,
        email,
        workspaceId: "team",
        password: "synthetic-multi-session-password",
      });
      const login = await context.app.inject({
        method: "POST",
        url: "/api/auth/login",
        headers: { origin },
        payload: { email, password: "synthetic-multi-session-password" },
      });
      expect(login.statusCode, login.body).toBe(200);
      sessions.push({
        cookie: `pm_session=${login.cookies[0]!.value}`,
        csrf: login.json().csrf,
      });
    }
    const read = async (session: number) =>
      (
        await context.app.inject({
          method: "GET",
          url: "/api/workspace",
          headers: { origin, cookie: sessions[session]!.cookie },
        })
      ).json<Snapshot>();
    const write = (session: number, payload: unknown, key: string) =>
      context.app.inject({
        method: "POST",
        url: "/api/tasks/bulk-update",
        headers: {
          origin,
          cookie: sessions[session]!.cookie,
          "x-csrf-token": sessions[session]!.csrf,
          "idempotency-key": key,
        },
        payload: payload as Record<string, unknown>,
      });
    const initial = await read(0);
    const leaves = initial.tasks
      .filter(
        (task) => !initial.tasks.some((child) => child.parentId === task.id),
      )
      .slice(0, 2);
    const targets = leaves.map((task) => ({
      id: task.id,
      version: task.version,
    }));
    const drafts = [
      { targets, change: { field: "status", value: "blocked" } },
      { targets, change: { field: "dueDate", value: "2030-01-01" } },
    ];
    const keys = [randomUUID(), randomUUID()];
    const responses = await Promise.all(
      drafts.map((draft, index) => write(index, draft, keys[index]!)),
    );
    expect(responses.map((response) => response.statusCode).sort()).toEqual([
      200, 409,
    ]);
    const winner = responses.findIndex(
        (response) => response.statusCode === 200,
      ),
      loser = 1 - winner;
    const acknowledged = responses[winner]!.json<Task[]>();
    expect(
      responses[loser]!.json()
        .conflicts.map((item: { id: string }) => item.id)
        .sort(),
    ).toEqual(leaves.map((task) => task.id).sort());
    const polls = await Promise.all(sessions.map((_, index) => read(index)));
    for (const poll of polls) {
      expect(poll).toEqual(polls[0]);
      for (const saved of acknowledged)
        expect(poll.tasks.find((task) => task.id === saved.id)).toEqual(saved);
    }
    const audits = polls[0]!.activities.filter(
      (activity) => activity.action === "Bulk updated task",
    );
    expect(audits).toHaveLength(2);
    expect(new Set(audits.map((activity) => activity.source)).size).toBe(1);
    const replay = await write(winner, drafts[winner], keys[winner]!);
    expect(replay.statusCode).toBe(200);
    expect(replay.json()).toEqual(acknowledged);
    expect(await read(2)).toEqual(polls[0]);
    const otherSessionSameKey = await write(2, drafts[winner], keys[winner]!);
    expect(otherSessionSameKey.statusCode).toBe(409);
    expect(await read(2)).toEqual(polls[0]);
    const refreshed = acknowledged.map((task) => ({
      id: task.id,
      version: task.version,
    }));
    const corrected = await write(
      4,
      { targets: refreshed, change: { field: "dueDate", value: null } },
      randomUUID(),
    );
    expect(corrected.statusCode, corrected.body).toBe(200);
    const latest = await read(4);
    for (const saved of corrected.json<Task[]>())
      expect(latest.tasks.find((task) => task.id === saved.id)).toMatchObject({
        version: saved.version,
        dueDate: null,
      });
    expect((await write(winner, drafts[winner], keys[winner]!)).json()).toEqual(
      acknowledged,
    );
    expect(await read(3)).toEqual(latest);
    const expired = await context.app.inject({
      method: "POST",
      url: "/api/tasks/bulk-update",
      headers: {
        origin,
        cookie: "pm_session=synthetic-expired",
        "x-csrf-token": sessions[0]!.csrf,
        "idempotency-key": randomUUID(),
      },
      payload: drafts[0],
    });
    expect(expired.statusCode).toBe(401);
    expect(await read(1)).toEqual(latest);
  } finally {
    await context.app.close();
  }
});
