export const APP_THEME_STORAGE_KEY = "roommates-app-theme";

export type AppThemeId =
  | "light"
  | "dark"
  | "ocean"
  | "lavender"
  | "forest"
  | "sunset"
  | "rose"
  | "amber"
  | "slate"
  | "berry";

export const APP_THEME_OPTIONS: {
  id: AppThemeId;
  label: string;
  hint: string;
  /** Background and accent swatches (for Profile picker) */
  swatchBg: string;
  swatchAccent: string;
}[] = [
  { id: "light", label: "Light", hint: "White and blue", swatchBg: "#f8fafc", swatchAccent: "#2563eb" },
  { id: "dark", label: "Dark", hint: "Navy and violet", swatchBg: "#0b1020", swatchAccent: "#a78bfa" },
  { id: "ocean", label: "Ocean", hint: "Aqua and teal", swatchBg: "#ecfeff", swatchAccent: "#0d9488" },
  { id: "lavender", label: "Lavender", hint: "Soft purple", swatchBg: "#f5f3ff", swatchAccent: "#7c3aed" },
  { id: "forest", label: "Forest", hint: "Mint and green", swatchBg: "#ecfdf5", swatchAccent: "#15803d" },
  { id: "sunset", label: "Sunset", hint: "Peach and coral", swatchBg: "#fff7ed", swatchAccent: "#ea580c" },
  { id: "rose", label: "Rose", hint: "Blush and pink", swatchBg: "#fdf2f8", swatchAccent: "#e11d48" },
  { id: "amber", label: "Amber", hint: "Warm gold", swatchBg: "#fffbeb", swatchAccent: "#d97706" },
  { id: "slate", label: "Slate", hint: "Cool gray", swatchBg: "#f1f5f9", swatchAccent: "#475569" },
  { id: "berry", label: "Berry", hint: "Plum and magenta", swatchBg: "#faf5ff", swatchAccent: "#a21caf" },
];

const VALID = new Set<string>([
  "light",
  "dark",
  "ocean",
  "lavender",
  "forest",
  "sunset",
  "rose",
  "amber",
  "slate",
  "berry",
]);

export function isAppThemeId(value: string | null | undefined): value is AppThemeId {
  return value != null && VALID.has(value);
}

export function getStoredAppThemeId(): AppThemeId | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(APP_THEME_STORAGE_KEY);
    return isAppThemeId(raw) ? raw : null;
  } catch {
    return null;
  }
}

/**
 * Light uses `:root` defaults; other themes set `data-app-theme` on `<html>`.
 * Also updates localStorage and the meta `theme-color` when possible.
 */
export function applyAppTheme(themeId: AppThemeId): void {
  if (typeof document === "undefined") return;
  if (themeId === "light") {
    document.documentElement.removeAttribute("data-app-theme");
  } else {
    document.documentElement.setAttribute("data-app-theme", themeId);
  }
  try {
    window.localStorage.setItem(APP_THEME_STORAGE_KEY, themeId);
  } catch {
    /* private mode, etc. */
  }

  const bar = getComputedStyle(document.documentElement).getPropertyValue("--app-theme-color").trim();
  if (bar) {
    const meta = document.querySelector('meta[name="theme-color"]');
    if (meta) meta.setAttribute("content", bar);
  }
}
