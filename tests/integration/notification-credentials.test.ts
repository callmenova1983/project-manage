import { testDatabaseConfig } from "../pg-helpers.js";
import { expect, it } from "vitest";
import {
  mkdtempSync,
  readFileSync,
  rmSync,
  statSync,
  unlinkSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Repository } from "../../apps/api/src/database";
import { NotificationCredentialStore } from "../../apps/api/src/notification-credentials";
it("encrypts separate notification credentials, survives restart and refuses to replace a lost key", async () => {
  const folder = mkdtempSync(join(tmpdir(), "pm-notification-credentials-")),
    path = join(folder, "test.sqlite");
  let repo = await Repository.open(testDatabaseConfig(path));
  try {
    await repo.workspace("a");
    await repo.workspace("b");
    const config = {
      enabled: true,
      corpId: "synthetic-corp",
      agentId: 1000001,
      baseUrl: "https://pm.example.test",
      secret: "synthetic-notification-only-secret",
    };
    await new NotificationCredentialStore(repo, path + ".credentials-key").save(
      "a",
      1,
      config,
    );
    expect(
      String(
        (await repo.db
          .prepare(
            "SELECT encrypted_config FROM notification_wecom_config WHERE workspace_id='a'",
          )
          .get())!.encrypted_config,
      ),
    ).not.toContain(config.secret);
    expect(statSync(path + ".credentials-key").mode & 0o777).toBe(0o600);
    const key = readFileSync(path + ".credentials-key");
    await repo.close();
    repo = await Repository.open(testDatabaseConfig(path));
    const store = new NotificationCredentialStore(
      repo,
      path + ".credentials-key",
    );
    expect(await store.read("a")).toEqual({ version: 1, config });
    expect(await store.read("b")).toBeUndefined();
    expect(readFileSync(path + ".credentials-key")).toEqual(key);
    unlinkSync(path + ".credentials-key");
    await expect(
      new NotificationCredentialStore(repo, path + ".credentials-key").read(
        "a",
      ),
    ).rejects.toThrow("credential encryption key is missing");
  } finally {
    await repo.close();
    rmSync(folder, { recursive: true, force: true });
  }
});
