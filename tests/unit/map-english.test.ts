import { expect, it } from "vitest";
import {
  englishNameFallback,
  englishPlace,
  hasHan,
  romanizeName,
} from "../../apps/web/src/services/map-english";
import {
  projectCities,
  projectDistricts,
} from "../../packages/domain/project-location";
import { mapTranslationInput } from "../../packages/domain/map-translation";
import { validateMapTranslation } from "../../apps/api/src/ai/map-translation";

it("uses English geography across the entire supported city and district catalogue", () => {
  for (const place of [...projectCities, ...projectDistricts]) {
    expect(englishPlace(place.name)).not.toBe("");
    expect(hasHan(englishPlace(place.name))).toBe(false);
  }
  expect(englishPlace("宁波")).toBe("Ningbo");
  expect(englishPlace("云和县")).toBe("Yunhe County");
  expect(englishPlace("北仑区")).toBe("Beilun District");
});

it("keeps English names and romanizes proper names without changing the source", () => {
  expect(englishNameFallback("Atlas Customer Portal")).toBe(
    "Atlas Customer Portal",
  );
  const original = "云和玩具城酒店";
  expect(englishNameFallback(original)).toContain("Toy City Hotel");
  expect(original).toBe("云和玩具城酒店");
  expect(hasHan(romanizeName("郑元杰"))).toBe(false);
  expect(hasHan(englishNameFallback("项目𠮷·香港消防 kelvin"))).toBe(false);
});

it("rejects oversized or unconfirmed translation input", () => {
  expect(
    mapTranslationInput.safeParse({
      texts: ["名称"],
      externalProcessingConfirmed: false,
    }).success,
  ).toBe(false);
  expect(
    mapTranslationInput.safeParse({
      texts: Array(4).fill("字".repeat(4000)),
      externalProcessingConfirmed: true,
    }).success,
  ).toBe(false);
});

it("requires a complete English-only result for every source text", () => {
  expect(
    validateMapTranslation({ translations: ["Factory project"] }, ["工厂项目"]),
  ).toEqual({ translations: ["Factory project"] });
  for (const translations of [[], ["工厂 Project"], [""], ["A", "B"]])
    expect(() =>
      validateMapTranslation({ translations }, ["工厂项目"]),
    ).toThrow();
});
