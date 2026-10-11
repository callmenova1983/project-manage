# Set your own test password in a private Codespace terminal

This is a local operator command for an existing account. It adds no public password-reset/registration route and does not disable authentication. Only someone who already controls the private Codespace and its application database can run it. The public forwarded application URL is not a terminal or reset link.

## User steps (including phone users)

1. Open your existing **private Codespace** under your GitHub account. Open its Terminal in the project repository. Use only your own session, with no screen sharing, shared terminal, terminal recording, Live Share participant or assistant control while entering the password.
2. After the code has been updated as below, run:

   ```bash
   npm run user:reset-password -- demo@example.test
   ```

3. Check the displayed account and database path. Type your own password/passphrase (14–500 characters) and press Enter. Nothing is shown while typing, including no stars; this is normal. Type it again and press Enter. Backspace works; Ctrl+U clears the current entry.
4. When both entries match, read the confirmation. Type `RESET` and press Enter to submit. This confirmation also stays hidden. Any other confirmation cancels; Ctrl+C cancels before submission. A mismatch or invalid length exits without changing the account. Never put the password in the command, chat, environment variables or a shared file.
5. When the command reports success, refresh the application and sign in as `demo@example.test` with the password **you entered**. All old sessions have been signed out. You can let your browser save/fill it. The previous generated credential file, if present, is not read or updated by this command; its old password is no longer valid.

If the terminal is difficult to use on your phone, the same private Codespace can be opened on your own computer. Actual mobile keyboard/browser behavior is not verified; Linux terminal input and cancellation are tested through an isolated pseudo-terminal. No one needs to receive your password in chat.

## Update the existing test environment

The operator may prepare the source and restart the application; the **user** performs steps 2–4 above. Do not run the reset command on their behalf.

In the existing repository on branch `feat/fullstack-dark-workspace`:

```bash
git pull --ff-only origin feat/fullstack-dark-workspace
npm run build
```

Use `npm ci` first only if dependencies are not installed. Dependencies have not changed for this feature. Restart the existing API process using its current startup method, port 3001, database and origin settings. This loads the login concurrency guard before the user resets their password. Keep AI disabled and keep the current authentication configuration. No Site publication or port visibility change is required.

The reset command reads the existing `DATABASE_PATH` environment setting (or the same `.env` convention as the server), falling back to `./data/project-manage.sqlite`. If the running server uses a different database, set that **non-secret path** for the command. The command displays its resolved database path before asking for passwords, refuses a missing database/account, never creates an account and does not run migrations or reseed data. Do not rerun `setup:local`, remove the database or replace the workspace to reset a password.

For a compiled-only installation without dev dependencies, after building use:

```bash
node dist/server/apps/api/src/reset-password.js demo@example.test
```

## Guarantees and limits

- Requires interactive stdin and stdout TTYs; pipes, redirected output, password arguments and password environment variables are not supported.
- Input is hidden before the prompt is displayed. Passwords are not echoed, logged, written to a credential file or sent over HTTP by the command. They exist briefly in the Node process; JavaScript cannot promise memory zeroization or defend against an administrator/terminal recorder controlling the environment.
- Uses the existing salted scrypt scheme and 14–500 character rule. Both password entries and exact `RESET` confirmation are required before opening the database for writes.
- Hash update and deletion of all account sessions occur in a single SQLite transaction. Other users, projects, tasks, data and configuration remain unchanged. Failure to revoke sessions rolls back the hash update.
- An optimistic hash guard prevents overwriting a reset made by another operator while the prompt was open. The login route checks the verified hash again in the same transaction that creates its session, blocking an in-flight old-password login after a reset commits.
- Ctrl+C, mismatch, invalid length and declined confirmation do not update credentials or sessions. Once the user submits `RESET`, the update is atomic; closing the terminal after submission is not an undo operation.

Tests use only temporary databases and synthetic accounts/passwords. They cover successful reset, session isolation/revocation, old/new login, rollback, concurrent reset/login, actual PTY non-echo, cancellation, mismatch and rejection of piped input. No existing test deployment account is reset as part of development or CI.
