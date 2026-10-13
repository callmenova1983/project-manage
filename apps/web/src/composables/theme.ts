import { readonly, ref } from "vue";

export type Theme = "dark" | "light";
export const ACCENT_STORAGE_KEY = "project-manage-accent";
export const ACCENTS = ["blue", "teal", "green", "orange"] as const;
export type Accent = (typeof ACCENTS)[number];
export const THEME_STORAGE_KEY = "project-manage-theme";

interface ThemeEnvironment {
  storage?: Pick<Storage, "getItem" | "setItem">;
  root?: Pick<HTMLElement, "setAttribute"> & {
    classList?: Pick<DOMTokenList, "toggle">;
  };
  media?: Pick<
    MediaQueryList,
    "matches" | "addEventListener" | "removeEventListener"
  >;
}

function browserEnvironment(): ThemeEnvironment {
  if (typeof window === "undefined") return {};
  let storage: ThemeEnvironment["storage"];
  try {
    storage = window.localStorage;
  } catch {
    // Private or restricted storage must not prevent a theme change.
  }
  return {
    storage,
    root: document.documentElement,
    media: window.matchMedia?.("(prefers-color-scheme: dark)"),
  };
}

/** Each controller owns one system listener; the app shares a single instance. */
export function createThemePreference(
  environment: ThemeEnvironment = browserEnvironment(),
) {
  let saved: string | null = null;
  try {
    saved = environment.storage?.getItem(THEME_STORAGE_KEY) ?? null;
  } catch {
    // Use the system preference when storage cannot be read.
  }
  let savedAccent: string | null = null;
  try {
    savedAccent = environment.storage?.getItem(ACCENT_STORAGE_KEY) ?? null;
  } catch {
    /* Storage is optional. */
  }
  const accent = ref<Accent>(
    ACCENTS.includes(savedAccent as Accent) ? (savedAccent as Accent) : "blue",
  );
  function setAccent(value: Accent) {
    if (!ACCENTS.includes(value)) return;
    accent.value = value;
    environment.root?.setAttribute("data-accent", value);
    try {
      environment.storage?.setItem(ACCENT_STORAGE_KEY, value);
    } catch {
      /* Still applies for this visit. */
    }
  }
  environment.root?.setAttribute("data-accent", accent.value);
  const preference = ref<Theme | null>(
    saved === "dark" || saved === "light" ? saved : null,
  );
  const systemTheme = () =>
    environment.media ? (environment.media.matches ? "dark" : "light") : "dark";
  const theme = ref<Theme>(preference.value ?? systemTheme());
  function apply(value: Theme) {
    theme.value = value;
    environment.root?.setAttribute("data-theme", value);
    environment.root?.classList?.toggle("dark", value === "dark");
  }
  function setTheme(value: Theme) {
    preference.value = value;
    apply(value);
    try {
      environment.storage?.setItem(THEME_STORAGE_KEY, value);
    } catch {
      // Switching still works for this visit when persistence is unavailable.
    }
  }
  function followSystem(event: MediaQueryListEvent) {
    if (preference.value === null) apply(event.matches ? "dark" : "light");
  }
  apply(theme.value);
  environment.media?.addEventListener("change", followSystem);
  return {
    theme: readonly(theme),
    accent: readonly(accent),
    setAccent,
    preference: readonly(preference),
    setTheme,
    toggleTheme: () => setTheme(theme.value === "dark" ? "light" : "dark"),
    dispose: () =>
      environment.media?.removeEventListener("change", followSystem),
  };
}

let sharedPreference: ReturnType<typeof createThemePreference> | undefined;
export function useTheme() {
  return (sharedPreference ??= createThemePreference());
}
