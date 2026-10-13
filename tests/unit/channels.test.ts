import { expect, it } from "vitest";
import {
  defaultCatalogs,
  checkCatalogs,
  checkProjectCatalog,
  importCatalogs,
} from "../../packages/domain/admin";
import {
  channelEntries,
  projectChannel,
  channelEntry,
} from "../../packages/domain/channels";
import { createSeed } from "../../packages/domain/seed";
import { projectInput } from "../../packages/domain/types";

it("uses company for legacy projects and preserves all supplied channels", () => {
  expect(channelEntries({}).map((c) => c.shortName)).toEqual([
    "公司",
    "建工",
    "美象",
    "邺城",
    "开芯",
    "铂宇",
  ]);
  expect(projectChannel({})).toBe("company");
  const legacy = { version: 1, stages: defaultCatalogs.stages, categories: [] };
  expect(() =>
    checkCatalogs(defaultCatalogs, legacy, createSeed().projects),
  ).not.toThrow();
});
it("protects the default and channel history while preventing new assignments to disabled channels", () => {
  const seed = createSeed(),
    project = { ...seed.projects[0]!, channelId: "boyu" };
  const next = structuredClone(defaultCatalogs);
  next.channels!.find((c) => c.id === "boyu")!.archived = true;
  expect(() => checkCatalogs(next, defaultCatalogs, [project])).not.toThrow();
  expect(() =>
    checkProjectCatalog(projectInput.strip().parse(project), next, project),
  ).not.toThrow();
  expect(() =>
    checkProjectCatalog(projectInput.strip().parse(project), next),
  ).toThrow("有效渠道");
  const noDefault = structuredClone(next);
  noDefault.channels!.find((c) => c.id === "company")!.archived = true;
  expect(() => checkCatalogs(noDefault, defaultCatalogs, [project])).toThrow(
    "默认渠道",
  );
  next.channels = next.channels!.filter((c) => c.id !== "boyu");
  expect(() => checkCatalogs(next, defaultCatalogs, [project])).toThrow(
    "不能直接删除",
  );
});
it("requires admin permission to import changed channels and rejects unknown references", () => {
  const seed = createSeed(),
    next = structuredClone(defaultCatalogs);
  next.channels!.find((c) => c.id === "boyu")!.name = "铂宇渠道全称";
  expect(() =>
    importCatalogs(
      { schemaVersion: 2, catalogs: next, projects: seed.projects },
      defaultCatalogs,
      false,
    ),
  ).toThrow("Administrator");
  expect(() =>
    checkProjectCatalog(
      {
        ...projectInput.strip().parse(seed.projects[0]!),
        channelId: "unknown",
      },
      defaultCatalogs,
    ),
  ).toThrow("有效渠道");
});

it("rejects duplicate contact identities or multiple primary contacts", () => {
  const base = {
    id: "company",
    name: "公司",
    shortName: "公司",
    archived: false,
  };
  expect(
    channelEntry.safeParse({
      ...base,
      contacts: [
        { id: "a", name: "甲", primary: true },
        { id: "b", name: "乙", primary: true },
      ],
    }).success,
  ).toBe(false);
  expect(
    channelEntry.safeParse({
      ...base,
      contacts: [
        { id: "a", name: "甲" },
        { id: "a", name: "乙" },
      ],
    }).success,
  ).toBe(false);
});
