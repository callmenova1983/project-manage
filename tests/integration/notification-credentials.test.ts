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
it("encrypts separate notification credentials, survives restart and refuses to replace a lost key", () => {
  const folder = mkdtempSync(join(tmpdir(), "pm-notification-credentials-")),
    path = join(folder, "test.sqlite");
  let repo = new Repository(path);
  try {
    repo.workspace("a");
    repo.workspace("b");
    const config = {
      enabled: true,
      corpId: "synthetic-corp",
      agentId: 1000001,
      baseUrl: "https://pm.example.test",
      secret: "synthetic-notification-only-secret",
    };
    new NotificationCredentialStore(repo, path).save("a", 1, config);
    expect(
      String(
        repo.db
          .prepare(
            "SELECT encrypted_config FROM notification_wecom_config WHERE workspace_id='a'",
          )
          .get()!.encrypted_config,
      ),
    ).not.toContain(config.secret);
    expect(statSync(path + ".credentials-key").mode & 0o777).toBe(0o600);
    const key = readFileSync(path + ".credentials-key");
    repo.close();
    repo = new Repository(path);
    const store = new NotificationCredentialStore(repo, path);
    expect(store.read("a")).toEqual({ version: 1, config });
    expect(store.read("b")).toBeUndefined();
    expect(readFileSync(path + ".credentials-key")).toEqual(key);
    unlinkSync(path + ".credentials-key");
    expect(() => new NotificationCredentialStore(repo, path).read("a")).toThrow(
      "credential encryption key is missing",
    );
  } finally {
    repo.close();
    rmSync(folder, { recursive: true, force: true });
  }
});
