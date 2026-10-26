import { checkEntry } from "./entry-check.js";
try {
  if (!process.argv[2])
    throw new Error(
      "Usage: npm run check:entry -- https://your-approved-origin",
    );
  const result = await checkEntry(process.argv[2]);
  console.log(JSON.stringify(result, null, 2));
  if (!result.passed) process.exitCode = 1;
} catch {
  console.error(
    "Entry check failed. Supply an HTTP(S) origin without credentials, path, query or fragment.",
  );
  process.exitCode = 1;
}
