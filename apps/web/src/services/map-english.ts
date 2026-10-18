import { pinyin } from "pinyin-pro";
import {
  projectCities,
  projectDistricts,
} from "../../../../packages/domain/project-location";
import { hasHan } from "../../../../packages/domain/map-translation";

export { hasHan };
const titleCase = (text: string) =>
  text.replace(/\b[a-z]/g, (c) => c.toUpperCase());
export function romanizeName(text: string) {
  return (
    titleCase(pinyin(text, { toneType: "none", nonZh: "consecutive" }))
      .replace(/\p{Script=Han}/gu, "")
      .replace(/\s+/g, " ")
      .trim() || "Unnamed"
  );
}
const places = new Map<string, string>(
  projectCities.map((city) => [
    city.name,
    (
      {
        "hong-kong": "Hong Kong",
        hongkong: "Hong Kong",
        macau: "Macau",
        macao: "Macau",
      } as Record<string, string>
    )[city.id] ?? titleCase(city.id.replace(/-/g, " ")),
  ]),
);
for (const district of projectDistricts) {
  const suffix = district.name.endsWith("县")
    ? " County"
    : district.name.endsWith("区")
      ? " District"
      : district.name.endsWith("市")
        ? " City"
        : "";
  const stem = suffix ? district.name.slice(0, -1) : district.name;
  const name = titleCase(
    pinyin(stem, { toneType: "none", type: "array" }).join(""),
  );
  places.set(district.name, name + suffix);
}
export function englishPlace(text: string) {
  return places.get(text) ?? (hasHan(text) ? romanizeName(text) : text);
}

// This is an honest name fallback, not a machine translation of project reports.
const terms: Record<string, string> = {
  玩具城: "Toy City",
  职业技术学校: "Vocational and Technical School",
  体育公园: "Sports Park",
  化工园: "Chemical Park",
  能耗改造升级: "Energy Efficiency Upgrade",
  工厂: "Factory",
  酒店: "Hotel",
  项目: "Project",
  展板: "Exhibition Board",
  设备: "Equipment",
  园区: "Industrial Park",
  码头: "Terminal",
  总部: "Headquarters",
};
const names = [...places, ...Object.entries(terms)].sort(
  ([a], [b]) => b.length - a.length,
);
const namePattern = new RegExp(names.map(([key]) => key).join("|"), "g");
const namesByText = new Map(names);
export function englishNameFallback(text: string) {
  if (!hasHan(text)) return text;
  return text
    .replace(namePattern, (match) => ` ${namesByText.get(match)} `)
    .replace(/\p{Script=Han}+/gu, romanizeName)
    .replace(/[，、；：。]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}
