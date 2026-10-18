import { readFileSync } from "node:fs";
import { compareAssistantRuns } from "./assistant-comparison.js";

const [baseline, candidate, ...extra] = process.argv.slice(2);
if (!baseline || !candidate || extra.length) {
  console.error(
    "Usage: tsx scripts/compare-assistant-runs.ts baseline.json candidate.json",
  );
  process.exitCode = 2;
} else {
  try {
    const result = compareAssistantRuns(
      JSON.parse(readFileSync(baseline, "utf8")),
      JSON.parse(readFileSync(candidate, "utf8")),
    );
    console.log(JSON.stringify(result, null, 2));
    process.exitCode =
      result.status === "passed" ? 0 : result.status === "failed" ? 1 : 2;
  } catch {
    console.error(
      "Comparison input is unreadable or invalid. No acceptance result was produced.",
    );
    process.exitCode = 2;
  }
}
