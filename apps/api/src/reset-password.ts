import "dotenv/config";
import { realpathSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { z } from "zod";
import {
  assertPrivateTerminal,
  hiddenInput,
  TerminalCancelled,
} from "./terminal-secret.js";
import {
  findResetAccount,
  resetAccountPassword,
  validateNewPassword,
  PasswordResetError,
} from "./password-reset.js";

// This is a local operator command, never imported by the HTTP server.
async function main() {
  if (
    process.argv.length !== 3 ||
    !z.string().email().max(200).safeParse(process.argv[2]).success
  )
    throw new PasswordResetError(
      "Usage: npm run user:reset-password -- demo@example.test (no password arguments)",
    );
  assertPrivateTerminal();
  let path: string;
  try {
    path = realpathSync(
      process.env.DATABASE_PATH ?? "./data/project-manage.sqlite",
    );
  } catch {
    throw new PasswordResetError(
      "The database must already exist. Set DATABASE_PATH to the running application's database.",
    );
  }
  const lookup = new DatabaseSync(path, { readOnly: true });
  let account;
  try {
    account = findResetAccount(lookup, process.argv[2]!);
  } finally {
    lookup.close();
  }
  console.log(
    `Local password reset for ${account.email}\nDatabase: ${path}\nOnly continue in your own private Codespace terminal.\nNo password is shown or written to a credential file. Ctrl+C cancels before submission.`,
  );
  const entered = { first: "", second: "" };
  try {
    entered.first = await hiddenInput(
      "New password / 新密码 (14–500 characters, hidden): ",
    );
    validateNewPassword(entered.first);
    entered.second = await hiddenInput(
      "Repeat password / 再次输入新密码 (hidden): ",
    );
    if (entered.first !== entered.second)
      throw new PasswordResetError(
        "Passwords do not match. No changes were made.",
      );
    console.log(
      `Both entries match. Submitting will reset ${account.email} and sign out all its existing sessions.`,
    );
    const confirmation = await hiddenInput(
      "Type RESET then Enter to submit / 输入 RESET 后回车确认提交 (hidden; anything else cancels): ",
    );
    if (confirmation !== "RESET") {
      console.log("Cancelled. No changes were made.");
      return;
    }
    const db = new DatabaseSync(path);
    try {
      db.exec("PRAGMA busy_timeout=5000");
      const revoked = await resetAccountPassword(db, account, entered.first);
      console.log(
        `Password updated. ${revoked} existing session(s) revoked. Sign in with the password you entered; your browser can save it.`,
      );
    } finally {
      db.close();
    }
  } finally {
    // Release references; JavaScript does not guarantee memory zeroization.
    entered.first = "";
    entered.second = "";
  }
}
try {
  await main();
} catch (error) {
  console.error(
    error instanceof PasswordResetError ||
      error instanceof TerminalCancelled ||
      (error instanceof Error &&
        error.message.startsWith("Use an interactive terminal"))
      ? error.message
      : "Password reset failed. Check the database path and access. No password or database details are printed.",
  );
  process.exitCode = 1;
}
