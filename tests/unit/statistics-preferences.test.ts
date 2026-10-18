import { expect, it } from "vitest";
import {
  defaultStatisticsPreferences,
  readStatisticsPreferences,
  writeStatisticsPreferences,
  statisticsLinkQuery,
  parseStatisticsLink,
} from "../../apps/web/src/services/statistics-preferences";
import { accountStorageKey } from "../../apps/web/src/services/account-storage";
it("roundtrips complete shared queries including empty scopes", () => {
  const query = defaultStatisticsPreferences().tasks;
  expect(
    parseStatisticsLink(statisticsLinkQuery(query).statistics).query,
  ).toEqual(query);
  expect(
    parseStatisticsLink('{"projects":["deleted"]}').query?.projects,
  ).toEqual(["deleted"]);
  expect(parseStatisticsLink("bad").query).toBeNull();
});
it("preserves corrupt and newer stored settings", () => {
  let raw = '{"version":9}';
  const storage = {
    getItem: () => raw,
    setItem: (_key: string, value: string) => {
      raw = value;
    },
  };
  expect(readStatisticsPreferences(storage, "key").error).not.toBe("");
  expect(
    writeStatisticsPreferences(storage, "key", defaultStatisticsPreferences()),
  ).not.toBe("");
  expect(raw).toBe('{"version":9}');
});
it("isolates mode, workspace and account", () => {
  const keys = [
    accountStorageKey("statistics", "local", { id: "a", workspaceId: "w" }),
    accountStorageKey("statistics", "server", { id: "a", workspaceId: "w" }),
    accountStorageKey("statistics", "local", { id: "b", workspaceId: "w" }),
    accountStorageKey("statistics", "local", { id: "a", workspaceId: "v" }),
  ];
  expect(new Set(keys).size).toBe(4);
});
