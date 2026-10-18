import { pinyin } from "pinyin-pro";
import type { Project } from "./types.js";

const cache = new WeakMap<Project, { signature: string; tokens: string[] }>();
const compact = (value: string) => value.toLowerCase().replace(/\s+/gu, "");

/** Cache only short project labels, never progress logs or whole snapshots. */
export function matchesProjectPinyin(project: Project, query: string): boolean {
  const labels = [project.name, project.shortName ?? "", ...project.aliases];
  const signature = JSON.stringify(labels);
  let entry = cache.get(project);
  if (!entry || entry.signature !== signature) {
    const tokens = labels.flatMap((label) => {
      const words = pinyin(label, {
        type: "array",
        toneType: "none",
        v: true,
        nonZh: "consecutive",
      });
      return [
        compact(label),
        compact(words.join("")),
        compact(words.map((word) => word[0] ?? "").join("")),
      ];
    });
    entry = { signature, tokens };
    cache.set(project, entry);
  }
  const needle = compact(query);
  return !!needle && entry.tokens.some((token) => token.includes(needle));
}
