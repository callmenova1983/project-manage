import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mkdtempSync, rmSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { execFileSync, spawnSync } from "node:child_process";
import { buildApp } from "../../apps/api/src/app.js";
import * as auth from "../../apps/api/src/auth.js";
import {
  findResetAccount,
  resetAccountPassword,
} from "../../apps/api/src/password-reset.js";
let context: Awaited<ReturnType<typeof buildApp>>,
  dir: string,
  database: string;
const oldPassword = "synthetic-original-passphrase";
const newPassword = "synthetic-replacement-passphrase";
const email = "demo@example.test";
const login = (password = oldPassword, account = email) =>
  context.app.inject({
    method: "POST",
    url: "/api/auth/login",
    payload: { email: account, password },
  });
const cookie = (response: Awaited<ReturnType<typeof login>>) =>
  `${response.cookies[0]!.name}=${response.cookies[0]!.value}`;
const session = (value: string) =>
  context.app.inject({ url: "/api/auth/session", headers: { cookie: value } });
beforeEach(async () => {
  dir = mkdtempSync(join(tmpdir(), "pm-reset-synthetic-"));
  database = join(dir, "test.sqlite");
  context = await buildApp({
    databasePath: database,
    origin: "http://localhost:4173",
  });
  await auth.createUser(context.repo, {
    email,
    name: "Synthetic Test",
    password: oldPassword,
    workspaceId: "synthetic",
  });
});
afterEach(async () => {
  vi.restoreAllMocks();
  await context.app.close();
  rmSync(dir, { recursive: true, force: true });
});
describe("local reset transaction and authenticated API", () => {
  it("changes only the selected hash, revokes all its sessions, and keeps other accounts working", async () => {
    await auth.createUser(context.repo, {
      email: "other@example.test",
      name: "Other Synthetic",
      password: oldPassword,
      workspaceId: "synthetic",
    });
    const first = cookie(await login()),
      second = cookie(await login()),
      other = cookie(await login(oldPassword, "other@example.test"));
    const snapshot = context.repo.snapshot("synthetic");
    const target = findResetAccount(context.repo.db, email.toUpperCase());
    expect(
      await resetAccountPassword(context.repo.db, target, newPassword),
    ).toBe(2);
    expect((await session(first)).statusCode).toBe(401);
    expect((await session(second)).statusCode).toBe(401);
    expect((await session(other)).statusCode).toBe(200);
    expect((await login()).statusCode).toBe(401);
    expect((await login(newPassword)).statusCode).toBe(200);
    expect(context.repo.snapshot("synthetic")).toEqual(snapshot);
  });
  it("rejects missing accounts and passwords outside the existing 14–500 rule without mutation", async () => {
    const target = findResetAccount(context.repo.db, email);
    expect(() =>
      findResetAccount(context.repo.db, "missing@example.test"),
    ).toThrow("Account not found");
    for (const password of ["short", "x".repeat(501)])
      await expect(
        resetAccountPassword(context.repo.db, target, password),
      ).rejects.toThrow("14–500");
    expect(findResetAccount(context.repo.db, email).previousHash).toBe(
      target.previousHash,
    );
    expect((await login()).statusCode).toBe(200);
  });
  it("rolls back the hash update if session revocation fails", async () => {
    const oldSession = cookie(await login());
    const target = findResetAccount(context.repo.db, email);
    context.repo.db.exec(
      "CREATE TRIGGER reject_revoke BEFORE DELETE ON sessions BEGIN SELECT RAISE(ABORT, 'synthetic failure'); END;",
    );
    await expect(
      resetAccountPassword(context.repo.db, target, newPassword),
    ).rejects.toThrow();
    expect(findResetAccount(context.repo.db, email).previousHash).toBe(
      target.previousHash,
    );
    expect((await session(oldSession)).statusCode).toBe(200);
  });
  it("rejects a stale reset target without overwriting a newer reset or revoking its new session", async () => {
    const target = findResetAccount(context.repo.db, email);
    await resetAccountPassword(context.repo.db, target, newPassword);
    const currentSession = cookie(await login(newPassword));
    await expect(
      resetAccountPassword(
        context.repo.db,
        target,
        "another-synthetic-passphrase",
      ),
    ).rejects.toThrow("account changed");
    expect((await session(currentSession)).statusCode).toBe(200);
    expect((await login(newPassword)).statusCode).toBe(200);
  });
  it("blocks an old-password login already in progress when reset commits", async () => {
    const original = auth.verifyPassword;
    let verified!: () => void, release!: () => void;
    const started = new Promise<void>((resolve) => {
      verified = resolve;
    });
    const paused = new Promise<void>((resolve) => {
      release = resolve;
    });
    vi.spyOn(auth, "verifyPassword").mockImplementationOnce(async (...args) => {
      const result = await original(...args);
      verified();
      await paused;
      return result;
    });
    const pending = login().then((value) => value);
    await started;
    await resetAccountPassword(
      context.repo.db,
      findResetAccount(context.repo.db, email),
      newPassword,
    );
    release();
    expect((await pending).statusCode).toBe(401);
    expect(
      context.repo.db.prepare("SELECT count(*) AS n FROM sessions").get()!.n,
    ).toBe(0);
    expect((await login(newPassword)).statusCode).toBe(200);
  });
});
function runPty(steps: [string, string][]) {
  // A clean environment: do not read the workspace's .env or any real credentials.
  const result = execFileSync(
    "python3",
    ["tests/fixtures/password-reset-pty.py"],
    {
      encoding: "utf8",
      timeout: 15000,
      input: JSON.stringify({
        command: [
          process.execPath,
          "--import",
          "tsx",
          "apps/api/src/reset-password.ts",
          email,
        ],
        steps,
      }),
      env: {
        PATH: process.env.PATH,
        DATABASE_PATH: database,
        DOTENV_CONFIG_PATH: join(dir, "no-env-file"),
        TERM: "xterm",
      },
    },
  );
  return JSON.parse(result) as {
    exitCode: number;
    output: string;
    stepsSent: number;
  };
}
describe.skipIf(process.platform === "win32")(
  "synthetic local terminal reset",
  () => {
    it("requires two hidden entries and exact explicit confirmation; no plaintext reaches terminal output or files", async () => {
      const oldSession = cookie(await login());
      const result = runPty([
        ["New password /", newPassword + "\r"],
        ["Repeat password /", newPassword + "\r"],
        ["Type RESET", "RESET\r"],
      ]);
      expect(result.exitCode).toBe(0);
      expect(result.stepsSent).toBe(3);
      expect(result.output).toContain("Password updated");
      expect(result.output).not.toContain(newPassword);
      expect(result.output).not.toContain(oldPassword);
      expect(result.output).not.toContain(
        findResetAccount(context.repo.db, email).previousHash,
      );
      expect(existsSync(join(dir, "local-login.txt"))).toBe(false);
      expect((await session(oldSession)).statusCode).toBe(401);
      expect((await login(newPassword)).statusCode).toBe(200);
    });
    it.each([
      {
        label: "mismatched confirmation",
        steps: [
          ["New password /", newPassword + "\r"],
          ["Repeat password /", "different-synthetic-passphrase\r"],
        ],
        exit: 1,
      },
      {
        label: "declined submission",
        steps: [
          ["New password /", newPassword + "\r"],
          ["Repeat password /", newPassword + "\r"],
          ["Type RESET", "no\r"],
        ],
        exit: 0,
      },
      {
        label: "Ctrl+C cancellation",
        steps: [["New password /", newPassword + "\u0003"]],
        exit: 1,
      },
      {
        label: "short password",
        steps: [["New password /", "short\r"]],
        exit: 1,
      },
    ])(
      "$label preserves the original credential and session",
      async ({ steps, exit }) => {
        const oldSession = cookie(await login());
        const target = findResetAccount(context.repo.db, email);
        const result = runPty(steps as [string, string][]);
        expect(result.exitCode).toBe(exit);
        expect(result.output).not.toContain(newPassword);
        expect(result.output).not.toContain("different-synthetic-passphrase");
        expect(findResetAccount(context.repo.db, email).previousHash).toBe(
          target.previousHash,
        );
        expect((await session(oldSession)).statusCode).toBe(200);
      },
    );
    it("refuses piped password input and extra command-line arguments", () => {
      const target = findResetAccount(context.repo.db, email);
      const options = {
        encoding: "utf8" as const,
        input: newPassword + "\n",
        env: {
          PATH: process.env.PATH,
          DATABASE_PATH: database,
          DOTENV_CONFIG_PATH: join(dir, "no-env-file"),
        },
      };
      const piped = spawnSync(
        process.execPath,
        ["--import", "tsx", "apps/api/src/reset-password.ts", email],
        options,
      );
      expect(piped.status).toBe(1);
      expect(piped.stderr).toContain("interactive terminal");
      expect(piped.stdout + piped.stderr).not.toContain(newPassword);
      const extra = spawnSync(
        process.execPath,
        [
          "--import",
          "tsx",
          "apps/api/src/reset-password.ts",
          email,
          "--password",
        ],
        options,
      );
      expect(extra.status).toBe(1);
      expect(extra.stderr).toContain("no password arguments");
      expect(findResetAccount(context.repo.db, email).previousHash).toBe(
        target.previousHash,
      );
      expect(resolve(database)).toContain("pm-reset-synthetic-");
    });
  },
);
