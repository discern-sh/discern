/** The site's theme policy: what each kind of document puts on its root and in its head. */

/** Where a reader's explicit choice is kept; the package behavior reads this name. */
export const THEME_STORAGE_KEY = "discern-theme";

/**
 * Apply a stored choice before the first paint. Without one the root keeps
 * `system`, so a reader with no preference follows their device with or
 * without JavaScript, and the package behavior resolves the control's label.
 */
export const THEME_BOOTSTRAP =
  `(function () {try {var t = localStorage.getItem("${THEME_STORAGE_KEY}");if (t === "light" || t === "dark") {document.documentElement.dataset.discernTheme = t;}} catch (_) {}})();`;

/** The browser chrome colour beside each theme. */
const CHROME_COLORS = { light: "#F7F5F8", dark: "#22252C" } as const;

/**
 * How a document comes by its theme. A `reader` document follows the device
 * until its reader chooses, and keeps that choice for every such document. A
 * `dark` document is dark for every reader on every device.
 */
export type DocumentTheme = "reader" | "dark";

/** Everything one document theme asks of the shell that renders it. */
interface DocumentThemeShell {
  /** Attributes the document root carries in the server's markup. */
  readonly rootAttributes: Readonly<Record<`data-discern-${string}`, string>>;
  /** A script that must run before the first paint, where the theme has one. */
  readonly bootstrap?: string;
  /** The `theme-color` entries, each with the device scheme it answers. */
  readonly chromeColors: readonly {
    readonly content: string;
    readonly media?: string;
  }[];
  /** Whether the document offers its reader a theme control. */
  readonly control: boolean;
}

/**
 * The one table of document themes. A `reader` root starts at `system`, which
 * leaves the theme to the emitted `prefers-color-scheme` rules, and names the
 * storage key that opts it into the package's persisted theme behavior. A
 * `dark` root states its theme outright and names no key, so nothing on the
 * page reads or writes the stored choice, and it needs no script to be dark.
 */
export const DOCUMENT_THEMES: Readonly<
  Record<DocumentTheme, DocumentThemeShell>
> = {
  reader: {
    rootAttributes: {
      "data-discern-theme": "system",
      "data-discern-theme-storage-key": THEME_STORAGE_KEY,
    },
    bootstrap: THEME_BOOTSTRAP,
    chromeColors: [
      { content: CHROME_COLORS.light, media: "(prefers-color-scheme: light)" },
      { content: CHROME_COLORS.dark, media: "(prefers-color-scheme: dark)" },
    ],
    control: true,
  },
  dark: {
    rootAttributes: { "data-discern-theme": "dark" },
    chromeColors: [{ content: CHROME_COLORS.dark }],
    control: false,
  },
};

/** Serialize a root's theme attributes for the shells that compose HTML as strings. */
export function themeRootAttributes(theme: DocumentTheme = "reader"): string {
  return Object.entries(DOCUMENT_THEMES[theme].rootAttributes)
    .map(([name, value]) => `${name}="${value}"`)
    .join(" ");
}
