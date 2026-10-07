/** Light is primary (DESIGN-SYSTEM §2); dark is a choice the viewer makes. */
export type Theme = "light" | "dark";

/** The theme a viewer gets until they choose one. */
export const DEFAULT_THEME: Theme = "light";

const THEME_KEY = "theme";

/** The viewer's choice on this device; null when none is stored or storage is unavailable. */
export function storedTheme(): Theme | null {
  let value: string | null;
  try {
    value = localStorage.getItem(THEME_KEY);
  } catch {
    return null;
  }
  return value === "dark" || value === "light" ? value : null;
}

/** The viewer's stored choice, else the default. */
export function initialTheme(): Theme {
  const stored = storedTheme();
  if (stored === null) return DEFAULT_THEME;
  return stored;
}

/** Applies a theme to the page (the tokens switch on `data-theme`) and remembers it. */
export function applyTheme(theme: Theme): void {
  document.documentElement.dataset["theme"] = theme;
  try {
    localStorage.setItem(THEME_KEY, theme);
  } catch {
    // Without storage the choice lasts until the page is reloaded.
  }
}

/** The theme the page shows now (set before first paint by main.tsx), else the viewer's stored choice. */
export function currentTheme(): Theme {
  const shown = document.documentElement.dataset["theme"];
  if (shown === "dark" || shown === "light") return shown;
  return initialTheme();
}
