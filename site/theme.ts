/** The site's theme storage policy and pre-paint bootstrap for every root. */

/** Where a reader's explicit choice is kept; the package behavior reads this name. */
export const THEME_STORAGE_KEY = "discern-theme";

/**
 * Root attributes every site shell carries. `system` leaves the theme to the
 * emitted `prefers-color-scheme` rules until a reader chooses, and the storage
 * key opts this root into the package's persisted theme behavior.
 */
export const THEME_ROOT_ATTRIBUTES = {
  "data-discern-theme": "system",
  "data-discern-theme-storage-key": THEME_STORAGE_KEY,
} as const;

/** Serialize the same attributes for the shells that compose HTML as strings. */
export function themeRootAttributes(): string {
  return Object.entries(THEME_ROOT_ATTRIBUTES)
    .map(([name, value]) => `${name}="${value}"`)
    .join(" ");
}

/**
 * Apply a stored choice before the first paint. Without one the root keeps
 * `system`, so a reader with no preference follows their device with or
 * without JavaScript, and the package behavior resolves the control's label.
 */
export const THEME_BOOTSTRAP =
  `(function () {try {var t = localStorage.getItem("${THEME_STORAGE_KEY}");if (t === "light" || t === "dark") {document.documentElement.dataset.discernTheme = t;}} catch (_) {}})();`;
