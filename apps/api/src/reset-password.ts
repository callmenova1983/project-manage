import "dotenv/config";
import { PostgresDatabase } from "./postgres.js";
import { readDatabaseConfig } from "./database-config.js";
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
  const config = readDatabaseConfig();
  // No migrations or account creation from a password reset command.
  const db = new PostgresDatabase(config);
  const entered = { first: "", second: "" };
  try {
    const account = await findResetAccount(db, process.argv[2]!);
    console.log(
      `Password reset for ${account.email}\nDatabase: ${config.host}:${config.port}/${config.database} (schema ${config.schema})\nOnly continue in your own private terminal.\nNo password is shown or written to a credential file. Ctrl+C cancels before submission.`,
    );
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
    const revoked = await resetAccountPassword(db, account, entered.first);
    console.log(
      `Password updated. ${revoked} existing session(s) revoked. Sign in with the password you entered; your browser can save it.`,
    );
  } finally {
    // Release references; JavaScript does not guarantee memory zeroization.
    entered.first = "";
    entered.second = "";
    await db.close();
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
      : "Password reset failed. Check the PostgreSQL configuration and access. No password or database details are printed.",
  );
  process.exitCode = 1;
}
