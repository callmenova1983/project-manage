import { pinyin } from "pinyin-pro";
const compoundSurnames = new Set([
  "欧阳",
  "司马",
  "上官",
  "诸葛",
  "东方",
  "皇甫",
  "尉迟",
  "公孙",
  "慕容",
  "司徒",
  "司空",
  "夏侯",
  "令狐",
  "长孙",
  "宇文",
  "南宫",
  "西门",
  "独孤",
  "轩辕",
  "钟离",
  "端木",
  "百里",
  "闻人",
  "公羊",
  "赫连",
  "澹台",
  "申屠",
  "濮阳",
  "太史",
  "乐正",
]);
export function suggestedLoginName(name: string): string {
  const clean = name.trim().replace(/\s+/g, " ");
  if (/^[\p{Script=Han}]+$/u.test(clean)) {
    const length = compoundSurnames.has(clean.slice(0, 2)) ? 2 : 1;
    const surname = pinyin(clean.slice(0, length), {
      toneType: "none",
      surname: "head",
      v: true,
      type: "array",
      traditional: true,
    }).join("");
    const given = pinyin(clean.slice(length), {
      toneType: "none",
      pattern: "first",
      type: "array",
      v: true,
      traditional: true,
    }).join("");
    return (
      (surname + given)
        .toLowerCase()
        .replace(/[^a-z0-9]/g, "")
        .slice(0, 60) || "member"
    );
  }
  const words = clean
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .split(/\s+/);
  const result = (
    (words[0] ?? "") +
    words
      .slice(1)
      .map((w) => w[0] ?? "")
      .join("")
  )
    .replace(/[^a-z0-9]/g, "")
    .replace(/^[^a-z]+/, "")
    .slice(0, 60);
  return result || "member";
}
export function availableLoginName(
  base: string,
  taken: (value: string) => boolean,
) {
  let candidate = base,
    suffix = 2;
  while (taken(candidate)) {
    const number = String(suffix++);
    candidate = base.slice(0, 64 - number.length) + number;
  }
  return candidate;
}
