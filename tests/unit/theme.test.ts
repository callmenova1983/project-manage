import { describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import {
  createThemePreference,
  THEME_STORAGE_KEY,
} from "../../apps/web/src/composables/theme";

function environment(saved: string | null = null, matches = false) {
  const values = new Map<string, string>([["project-manage-locale", "zh-CN"]]);
  if (saved !== null) values.set(THEME_STORAGE_KEY, saved);
  const storage = {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => values.set(key, value),
  };
  let listener: ((event: MediaQueryListEvent) => void) | undefined;
  const media = {
    matches,
    addEventListener: vi.fn(
      (_name: string, fn: EventListenerOrEventListenerObject) => {
        listener = fn as (event: MediaQueryListEvent) => void;
      },
    ),
    removeEventListener: vi.fn(),
  };
  const root = { setAttribute: vi.fn() };
  return {
    storage,
    media,
    root,
    values,
    change: (dark: boolean) =>
      listener?.({ matches: dark } as MediaQueryListEvent),
  };
}

describe("theme preference", () => {
  it("follows the system until the user explicitly selects a theme", () => {
    const env = environment(null, false);
    const controller = createThemePreference(env);
    expect(controller.theme.value).toBe("light");
    expect(controller.preference.value).toBeNull();
    expect(env.values.has(THEME_STORAGE_KEY)).toBe(false);
    env.change(true);
    expect(controller.theme.value).toBe("dark");
    expect(env.root.setAttribute).toHaveBeenLastCalledWith(
      "data-theme",
      "dark",
    );
    controller.setTheme("light");
    env.change(true);
    expect(controller.theme.value).toBe("light");
    expect(env.values.get(THEME_STORAGE_KEY)).toBe("light");
    expect(env.values.get("project-manage-locale")).toBe("zh-CN");
    controller.dispose();
    expect(env.media.removeEventListener).toHaveBeenCalledWith(
      "change",
      expect.any(Function),
    );
  });

  it("restores a valid stored preference independently of the system", () => {
    const env = environment("light", true);
    const controller = createThemePreference(env);
    expect(controller.theme.value).toBe("light");
    controller.toggleTheme();
    expect(controller.theme.value).toBe("dark");
    const restored = createThemePreference(env);
    expect(restored.theme.value).toBe("dark");
    expect(restored.preference.value).toBe("dark");
    restored.dispose();
    controller.dispose();
  });

  it("ignores invalid stored values and defaults to dark without browser APIs", () => {
    const env = environment("sepia", false);
    const controller = createThemePreference(env);
    expect(controller.theme.value).toBe("light");
    expect(controller.preference.value).toBeNull();
    expect(createThemePreference({}).theme.value).toBe("dark");
    controller.dispose();
  });

  it("remains usable when browser storage is blocked", () => {
    const root = { setAttribute: vi.fn() };
    const controller = createThemePreference({
      root,
      storage: {
        getItem: () => {
          throw new Error("Storage blocked");
        },
        setItem: () => {
          throw new Error("Storage blocked");
        },
      },
    });
    expect(() => controller.setTheme("light")).not.toThrow();
    expect(controller.theme.value).toBe("light");
    expect(root.setAttribute).toHaveBeenLastCalledWith("data-theme", "light");
  });
});

it("keeps small text and status labels above WCAG AA contrast in both palettes", () => {
  const css = readFileSync(
    new URL("../../apps/web/src/style.css", import.meta.url),
    "utf8",
  );
  const palettes = css.split(':root[data-theme="light"]');
  const colors = (source: string) =>
    Object.fromEntries(
      [...source.matchAll(/--([\w-]+): (#[\da-f]{6});/g)].map((m) => [
        m[1],
        m[2],
      ]),
    ) as Record<string, string>;
  const dark = colors(palettes[0]!);
  const light = { ...dark, ...colors(palettes[1]!.split(":root {")[0]!) };
  const luminance = (hex: string) =>
    hex
      .slice(1)
      .match(/../g)!
      .map((value) => parseInt(value, 16) / 255)
      .map((value) =>
        value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4,
      )
      .reduce((sum, value, i) => sum + value * [0.2126, 0.7152, 0.0722][i]!, 0);
  const contrast = (a: string, b: string) => {
    const [hi, lo] = [luminance(a), luminance(b)].sort((a, b) => b - a);
    return (hi! + 0.05) / (lo! + 0.05);
  };
  for (const [mode, palette] of Object.entries({ dark, light })) {
    for (const foreground of [
      "text",
      "text-secondary",
      "muted",
      "placeholder",
    ]) {
      for (const background of [
        "bg",
        "surface",
        "surface-subtle",
        "surface-raised",
        "surface-selected",
        "surface-hover",
        "accent-bg",
      ]) {
        expect(
          contrast(palette[foreground]!, palette[background]!),
          `${mode}: ${foreground} on ${background}`,
        ).toBeGreaterThanOrEqual(4.5);
      }
    }
    for (const status of [
      "status-todo",
      "status-in-progress",
      "status-done",
      "status-blocked",
      "stage-potential",
      "stage-proposal",
      "stage-approved",
    ]) {
      expect(
        contrast(palette[status]!, palette[`${status}-bg`]!),
        `${mode}: ${status}`,
      ).toBeGreaterThanOrEqual(4.5);
    }
    expect(
      contrast(palette["on-primary"]!, palette.primary!),
    ).toBeGreaterThanOrEqual(4.5);
  }
});
