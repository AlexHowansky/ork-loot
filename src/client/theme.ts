export type ThemeChoice = "auto" | "light" | "dark";

export const THEMES = { light: "fantasy", dark: "dim" } as const;
const KEY = "phat-loot-theme";

export function storedTheme(): ThemeChoice {
  try {
    const v = localStorage.getItem(KEY);
    return v === "light" || v === "dark" ? v : "auto";
  } catch {
    return "auto";
  }
}

/** Applies a theme choice; "auto" follows the system via --prefersdark. */
export function applyTheme(choice: ThemeChoice) {
  const root = document.documentElement;
  if (choice === "auto") root.removeAttribute("data-theme");
  else root.setAttribute("data-theme", THEMES[choice]);
  try {
    if (choice === "auto") localStorage.removeItem(KEY);
    else localStorage.setItem(KEY, choice);
  } catch {
    // Storage may be unavailable (private mode); the choice still applies.
  }
}
