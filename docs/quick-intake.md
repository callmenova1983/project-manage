# Quick intake

Open **Quick intake** from Projects or the workspace menu. Paste labeled English/Chinese text, paste a table, or choose/drop a TXT, CSV, TSV or XLSX file. Review candidates, adjust their target project and details, select the rows to create and confirm the final summary. Existing project fields are never silently overwritten: choosing an existing project adds a task only.

## Parsing and review

- Deterministic **rule-assisted** extraction; no model request or AI connection is implied. Keyboard/system dictation can enter text; the application does not record or upload audio.
- Chinese/English project, client, owner, stage, task, assignee, status and due-date labels/headers are recognized. Header mapping can be adjusted; multiple workbook sheets can be selected. Unsupported or missing information remains editable. Relative/invalid dates are flagged rather than invented.
- Files are parsed in the browser. XLSX parsing uses pinned `read-excel-file@9.3.12` in a dedicated worker. See the [maintainer's documentation](https://gitlab.com/catamphetamine/read-excel-file/-/raw/master/README.md). The reader does not execute formulas; it reads stored values. Legacy XLS and password-protected workbooks are not supported; export them to XLSX/CSV first.
- Limits: 2 MB file, 20 sheets, 200 data rows / 30 columns per sheet, 200,000 source characters, 20 MB declared archive expansion and a 15-second worker timeout. These limits are intended for reviewed batches rather than large database imports.
- Names/aliases are matched to existing projects. Ambiguous matches, unknown stages and uncertain dates are explicitly flagged. Duplicate project names or task titles need an additional confirmation. Date fields do not silently assign a work week.

## Storage and rollback

`WorkspaceApi.applyIntake` applies a single reviewed batch. The server validates the entire batch and persists project/task changes, original row evidence, audit history and a batch receipt in one SQLite transaction. Existing project versions are checked against the version captured during review. HTTP retries use the existing idempotency mechanism. Invalid later rows leave no partial creations.

The browser demo implements the same contract in its isolated local snapshot, with one storage write. It never calls the server API. Completed batches can be re-opened after reload under Recent intakes.

Undo requires explicit confirmation. It removes only entities created by that batch and records the reversal. Any edited/missing creation or later task/subtask dependency blocks undo; it never overwrites newer work. Exact source cells or text and source row numbers remain in the audit record. Only the 30 most recent batches are listed; server receipts remain stored.

Migration `004_intake.sql` adds the receipt table and index; existing projects, users and credentials are untouched. This increment does not enable provider calls or deploy the application.

Screenshots: [Chinese XLSX review](screenshots/intake-xlsx-review.png) · [compiled mobile review](screenshots/intake-built-mobile.png). Both contain synthetic data only.
