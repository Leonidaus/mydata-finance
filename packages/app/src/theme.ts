/**
 * The app is light whatever the device is set to, because S-mobiili is: a dark page would not
 * look like S-Pankki. The dark palette is kept and can be asked for with ?theme=dark in the
 * address.
 */
export type Theme = "light" | "dark";

export function themeFromUrl(search: string): Theme {
  return new URLSearchParams(search).get("theme") === "dark" ? "dark" : "light";
}

export const theme: Theme = typeof window === "undefined" ? "light" : themeFromUrl(window.location.search);

/** Marks the page with the theme; styles.css keys its dark palette on this attribute. */
export function applyTheme(): void {
  document.documentElement.dataset.theme = theme;
}
