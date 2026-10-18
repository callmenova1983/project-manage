import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  cityLocation,
  districtLocation,
  inferProjectLocation,
  locationKey,
  locationLabel,
  locationPrecisionLabel,
  nearestCity,
  pointLocation,
  projectCities,
  projectDistricts,
  projectLocationSchema,
  resolveCityText,
  resolveLocationText,
} from "../../packages/domain/project-location";
import { projectInput, snapshotImport } from "../../packages/domain/types";
import { createLocalApi } from "../../apps/web/src/services/local";
import { createSeed } from "../../packages/domain/seed";
import {
  makeProjectLocationRequest,
  validateProjectLocationAnalysis,
} from "../../apps/api/src/ai/project-location";
import type { QwenConfig } from "../../apps/api/src/ai/config";

describe("city-level project locations", () => {
  it.each([
    ["上海工厂项目", "shanghai", "city"],
    ["云和玩具城酒店", "lishui", "district"],
    ["青田学校", "lishui", "district"],
    ["缙云产业园", "lishui", "city"],
    ["宁海医院", "ningbo", "district"],
    ["象山体育馆", "ningbo", "city"],
    ["SHANGHAI factory", "shanghai", "city"],
  ])(
    "recognizes %s without implying a precise site",
    (name, cityId, precision) => {
      expect(inferProjectLocation({ name })).toMatchObject({
        status: "matched",
        location: { cityId, precision, confirmed: false, source: "name" },
      });
    },
  );
  it("keeps unknown and conflicting projects unlocated", () => {
    expect(inferProjectLocation({ name: "五粮液项目" })).toMatchObject({
      status: "unmatched",
      location: null,
    });
    expect(
      inferProjectLocation({ name: "杭州办公楼", client: "上海客户" }),
    ).toMatchObject({ status: "ambiguous", location: null });
    expect(
      inferProjectLocation({ name: "NanjingRoad Shanghai" }),
    ).toMatchObject({ status: "matched", location: { cityId: "shanghai" } });
  });
  it("recognizes text, county names and aliases but never a province alone", () => {
    expect(resolveCityText("浙江省宁波市鄞州区")).toMatchObject({
      status: "matched",
      location: { cityId: "ningbo", source: "text" },
    });
    expect(resolveCityText("浙江").status).toBe("unmatched");
    expect(resolveCityText("杭州或宁波").status).toBe("ambiguous");
    expect(
      inferProjectLocation({ name: "医院", aliases: ["义乌院区"] }).location
        ?.cityId,
    ).toBe("jinhua");
    expect(
      projectCities.filter((city) => city.province === "浙江"),
    ).toHaveLength(11);
  });
  it("snaps nearby clicks only, rejects invalid coordinates and ocean points", () => {
    expect(nearestCity(29.88, 121.56)?.id).toBe("ningbo");
    expect(nearestCity(0, 0)).toBeNull();
    expect(nearestCity(0, 0, 20000)).toBeNull();
    expect(nearestCity(Number.NaN, 121)).toBeNull();
    expect(nearestCity(91, 121)).toBeNull();
    expect(nearestCity(29.9, 181)).toBeNull();
  });
  it("validates known city identity, exact centre and finite coordinates", () => {
    const location = cityLocation("ningbo", "map", true, "地图点选");
    expect(projectLocationSchema.parse(location)).toEqual(location);
    for (const invalid of [
      { cityId: "unknown" },
      { city: "杭州" },
      { province: "四川" },
      { latitude: Number.NaN },
      { longitude: 181 },
      { latitude: location.latitude + 0.01 },
      { precision: "building" },
    ])
      expect(
        projectLocationSchema.safeParse({ ...location, ...invalid }).success,
      ).toBe(false);
    expect(() => cityLocation("unknown", "text")).toThrow();
    const project = projectInput.strip().parse(createSeed().projects[0]);
    expect(projectInput.parse(project).location).toBeUndefined();
    expect(
      projectInput.parse({ ...project, location: null }).location,
    ).toBeNull();
  });
  it("validates AI candidates against supported cities and exact project evidence", () => {
    const project = { ...createSeed().projects[0]!, name: "天一阁南馆" };
    expect(
      validateProjectLocationAnalysis(
        { candidates: [{ cityId: "ningbo", evidence: "天一阁" }] },
        project,
      ),
    ).toMatchObject({
      status: "matched",
      location: { source: "ai", confirmed: false, cityId: "ningbo" },
    });
    expect(
      validateProjectLocationAnalysis({ candidates: [] }, project).status,
    ).toBe("unmatched");
    expect(() =>
      validateProjectLocationAnalysis(
        { candidates: [{ cityId: "invented", evidence: "天一阁" }] },
        project,
      ),
    ).toThrow();
    expect(() =>
      validateProjectLocationAnalysis(
        { candidates: [{ cityId: "ningbo", evidence: "虚构证据" }] },
        project,
      ),
    ).toThrow();
    expect(() =>
      validateProjectLocationAnalysis(
        {
          candidates: [
            { cityId: "ningbo", evidence: "天一阁" },
            { cityId: "ningbo", evidence: "南馆" },
          ],
        },
        project,
      ),
    ).toThrow();
    const request = makeProjectLocationRequest(
      { ...project, notes: "PRIVATE_NOTES" },
      { model: "qwen-test", maxTokens: 2048 } as QwenConfig,
    );
    expect(JSON.stringify(request)).not.toContain("PRIVATE_NOTES");
    expect(JSON.parse(request.messages[1]!.content).project).not.toHaveProperty(
      "owner",
    );
  });
});

describe("district and explicit point locations", () => {
  it("uses the finest verified location without treating its parent as a conflict", () => {
    expect(resolveLocationText("浙江省宁波市北仑区园区")).toMatchObject({
      status: "matched",
      location: {
        precision: "district",
        cityId: "ningbo",
        district: "北仑区",
        confirmed: false,
      },
    });
    expect(resolveLocationText("宁波鄞州").location?.district).toBe("鄞州区");
    expect(resolveLocationText("丽水云和县").location?.district).toBe("云和县");
    expect(resolveLocationText("宁波北仑与鄞州")).toMatchObject({
      status: "ambiguous",
      location: null,
    });
    expect(resolveLocationText("宁波北仑与象山").status).toBe("ambiguous");
    expect(resolveLocationText("宁波象山").location?.precision).toBe("city");
    expect(resolveLocationText("杭州北仑区").status).toBe("ambiguous");
    expect(resolveLocationText("未支持的乡镇").status).toBe("unmatched");
    for (const candidate of resolveLocationText("宁波北仑与鄞州").candidates)
      expect(projectLocationSchema.safeParse(candidate.location).success).toBe(
        true,
      );
  });
  it.each([
    "121.8,29.9",
    "121.8，29.9",
    "经度121.8 纬度29.9",
    "纬度：29.9，经度：121.8",
    "lat=29.9 lon=121.8",
  ])("accepts explicit WGS84 coordinates: %s", (text) => {
    expect(resolveLocationText(text)).toMatchObject({
      status: "matched",
      candidates: [],
      location: {
        precision: "point",
        cityId: "",
        latitude: 29.9,
        longitude: 121.8,
        source: "text",
        coordinateSource: "user-coordinates",
        confirmed: false,
      },
    });
  });
  it("does not interpret arbitrary address numbers as coordinates or silently repair invalid input", () => {
    for (const text of [
      "181,29.9",
      "121.8,91",
      "29.9,121.8",
      "宁波经度181纬度29",
      "浙江省路121号29室",
      "坐标 121.8,29.9",
    ])
      expect(resolveLocationText(text).location).toBeNull();
    expect(inferProjectLocation({ name: "121.8,29.9" }).location).toBeNull();
    expect(pointLocation(-33.9, 151.2, "map")).toMatchObject({
      confirmed: false,
      coordinateSource: "manual-map",
    });
  });
  it("rejects forged districts, parent relationships and invented model coordinates", () => {
    const district = districtLocation("ningbo-beilun", "text");
    for (const invalid of [
      { district: "鄞州区" },
      { districtId: "invented" },
      { cityId: "shanghai" },
      { latitude: district.latitude + 0.1 },
      { coordinateSource: "manual-map" },
    ])
      expect(
        projectLocationSchema.safeParse({ ...district, ...invalid }).success,
      ).toBe(false);
    const point = pointLocation(29.9, 121.8, "text");
    for (const invalid of [
      { source: "ai" },
      { source: "name" },
      { coordinateSource: "manual-map" },
      { coordinateSource: undefined },
      { cityId: "ningbo" },
      { district: "北仑区" },
      { evidence: "" },
      { latitude: Infinity },
    ])
      expect(
        projectLocationSchema.safeParse({ ...point, ...invalid }).success,
      ).toBe(false);
    for (const district of projectDistricts) {
      expect(district.sourceUrl).toMatch(
        /^https:\/\/(?:www\.)?(wikidata|geonames)\.org\//,
      );
      expect(
        projectLocationSchema.safeParse(districtLocation(district.id, "name"))
          .success,
      ).toBe(true);
    }
  });
  it("labels and groups different precisions without conflating districts or exact points", () => {
    const a = districtLocation("ningbo-beilun", "text");
    const b = districtLocation("ningbo-yinzhou", "text");
    expect(locationKey(a)).not.toBe(locationKey(b));
    expect(locationKey(a)).not.toBe(
      locationKey(cityLocation("ningbo", "text")),
    );
    expect(locationLabel(a)).toBe("宁波 · 北仑区");
    expect(locationLabel(cityLocation("shanghai", "text"))).toBe("上海");
    expect(locationPrecisionLabel(a)).toBe("District centre");
    expect(locationPrecisionLabel(pointLocation(29.9, 121.8, "map"))).toBe(
      "Exact coordinates",
    );
  });
  it("validates AI district IDs, parent city and source evidence, never accepts point coordinates", () => {
    const project = {
      ...createSeed().projects[0]!,
      name: "宁波北仑园区与鄞州学校",
    };
    expect(
      validateProjectLocationAnalysis(
        {
          candidates: [
            { cityId: "ningbo", evidence: "宁波" },
            {
              cityId: "ningbo",
              districtId: "ningbo-beilun",
              evidence: "北仑园区",
            },
          ],
        },
        project,
      ),
    ).toMatchObject({ status: "matched", location: { district: "北仑区" } });
    expect(
      validateProjectLocationAnalysis(
        {
          candidates: [
            {
              cityId: "ningbo",
              districtId: "ningbo-beilun",
              evidence: "北仑园区",
            },
          ],
        },
        project,
      ),
    ).toMatchObject({
      status: "matched",
      location: {
        precision: "district",
        district: "北仑区",
        source: "ai",
        confirmed: false,
      },
      candidates: [{ location: { districtId: "ningbo-beilun" } }],
    });
    expect(
      validateProjectLocationAnalysis(
        {
          candidates: [
            {
              cityId: "ningbo",
              districtId: "ningbo-beilun",
              evidence: "北仑园区",
            },
            {
              cityId: "ningbo",
              districtId: "ningbo-yinzhou",
              evidence: "鄞州学校",
            },
          ],
        },
        project,
      ).status,
    ).toBe("ambiguous");
    for (const candidate of [
      { cityId: "shanghai", districtId: "ningbo-beilun", evidence: "北仑园区" },
      { cityId: "ningbo", districtId: "invented", evidence: "北仑园区" },
      {
        cityId: "ningbo",
        latitude: 29.9,
        longitude: 121.8,
        evidence: "北仑园区",
      },
    ])
      expect(() =>
        validateProjectLocationAnalysis({ candidates: [candidate] }, project),
      ).toThrow();
  });
});

describe("local project location persistence", () => {
  const storage = new Map<string, string>();
  beforeEach(() => {
    storage.clear();
    vi.stubGlobal("localStorage", {
      getItem: (key: string) => storage.get(key) ?? null,
      setItem: (key: string, value: string) => storage.set(key, value),
    });
  });
  afterEach(() => vi.unstubAllGlobals());
  it("retains location across reload, old-editor saves and snapshot export/import parsing", async () => {
    const api = createLocalApi();
    const project = (await api.snapshot()).projects[0]!;
    const location = cityLocation("ningbo", "text", true, "宁波");
    const saved = await api.saveProject(
      { ...projectInput.strip().parse(project), location },
      project.id,
      project.version,
    );
    expect(
      (await createLocalApi().snapshot()).projects.find(
        (p) => p.id === project.id,
      )?.location,
    ).toEqual(location);
    const oldEditor = projectInput.strip().parse(saved);
    delete oldEditor.location;
    const next = await api.saveProject(
      { ...oldEditor, notes: "Other edit" },
      saved.id,
      saved.version,
    );
    expect(next.location).toEqual(location);
    expect(
      snapshotImport
        .parse(await api.snapshot())
        .projects.find((p) => p.id === saved.id)?.location,
    ).toEqual(location);
    const cleared = await api.saveProject(
      { ...projectInput.strip().parse(next), location: null },
      next.id,
      next.version,
    );
    expect(cleared.location).toBeNull();
  });
  it("rejects stale saves and preserves the current location", async () => {
    const api = createLocalApi();
    const project = (await api.snapshot()).projects[0]!;
    const location = cityLocation("ningbo", "map", true);
    await api.saveProject(
      { ...projectInput.strip().parse(project), location },
      project.id,
      project.version,
    );
    await expect(
      api.saveProject(
        {
          ...projectInput.strip().parse(project),
          location: cityLocation("shanghai", "text", true),
        },
        project.id,
        project.version,
      ),
    ).rejects.toMatchObject({ status: 409 });
    expect(
      (await api.snapshot()).projects.find((p) => p.id === project.id)
        ?.location,
    ).toEqual(location);
  });
  it("uses rules in local mode and never contacts a model", async () => {
    const api = createLocalApi();
    const project = (await api.snapshot()).projects[0]!;
    const saved = await api.saveProject(
      { ...projectInput.strip().parse(project), name: "云和酒店" },
      project.id,
      project.version,
    );
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    expect(
      await api.analyzeProjectLocation(saved.id, saved.version, true),
    ).toMatchObject({
      provider: "rules",
      model: null,
      location: { cityId: "lishui" },
    });
    expect(fetchMock).not.toHaveBeenCalled();
    expect(
      (await api.snapshot()).projects.find((p) => p.id === project.id)
        ?.location,
    ).toBeUndefined();
  });
  it("can restore the version before a location was added", async () => {
    const api = createLocalApi();
    const project = (await api.snapshot()).projects[0]!;
    const saved = await api.saveProject(
      {
        ...projectInput.strip().parse(project),
        location: cityLocation("ningbo", "map", true),
      },
      project.id,
      project.version,
    );
    const event = (await api.snapshot()).activities.find(
      (item) =>
        item.entityId === project.id && item.after?.version === saved.version,
    )!;
    const restored = await api.restore(event.id, saved.version);
    expect((restored as typeof project).location).toBeUndefined();
  });
});
