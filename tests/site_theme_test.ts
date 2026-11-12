/** The site owns first paint and storage policy; the package owns the control. */
import { assert, assertEquals, assertStringIncludes } from "@std/assert";
// @ts-types="@types/jsdom"
import { JSDOM } from "jsdom";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { loadDocsSite } from "../site/docs.tsx";
import * as icons from "../site/ui/components/DocumentIcons.tsx";
import { THEME_STORAGE_KEY } from "../site/theme.ts";
import { handler, liveHtmlRoutes } from "../site/serve.ts";

const BROWSER = {
  accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
  "user-agent": "Mozilla/5.0 theme contract",
};

/**
 * The routes whose document is dark for every reader on every device. On
 * every other live route the theme is the reader's to choose.
 */
const DARK_ROUTES: ReadonlySet<string> = new Set(["/"]);

/** The device scheme a `theme-color` entry answers, as its media query. */
const SCHEME = {
  light: "(prefers-color-scheme: light)",
  dark: "(prefers-color-scheme: dark)",
} as const;

interface ThemeWindow extends Window {
  eval(source: string): unknown;
}

/** One theme control as the server rendered it. */
interface ControlMarkup {
  readonly pressed: string | null;
  readonly inert: boolean;
  readonly destinations: readonly (string | null)[];
}

/** Everything a served document says about its theme, before any script runs. */
interface ThemeMarkup {
  readonly route: string;
  /** Whether the root is one the package's theme rules apply to. */
  readonly tokenRoot: boolean;
  readonly theme: string | null;
  readonly storageKey: string | null;
  /** Each `theme-color` entry as `colour when media`. */
  readonly chrome: readonly string[];
  /** Every inline script that names the stored choice. */
  readonly bootstraps: readonly string[];
  readonly controls: readonly ControlMarkup[];
  /** Whether anything in the markup names the stored choice's key, as a value. */
  readonly namesStorage: boolean;
}

/** Read one served document's theme from its markup. */
function themeMarkup(route: string, html: string): ThemeMarkup {
  const dom = new JSDOM(html);
  const document = dom.window.document;
  const root = document.documentElement;
  const markup: ThemeMarkup = {
    route,
    tokenRoot: root.hasAttribute("data-discern-root"),
    theme: root.getAttribute("data-discern-theme"),
    storageKey: root.getAttribute("data-discern-theme-storage-key"),
    chrome: [...document.querySelectorAll('meta[name="theme-color"]')].map(
      (meta) =>
        `${meta.getAttribute("content")} when ${
          meta.getAttribute("media") ?? "always"
        }`,
    ),
    bootstraps: [...document.querySelectorAll("script:not([src])")]
      .map((script) => script.textContent ?? "")
      .filter((source) => source.includes(THEME_STORAGE_KEY))
      .map((source) => source.trim()),
    controls: [
      ...document.querySelectorAll("button[data-discern-theme-toggle]"),
    ].map((control) => ({
      pressed: control.getAttribute("aria-pressed"),
      inert: control.hasAttribute("inert"),
      destinations: [
        ...control.querySelectorAll("[data-discern-theme-destination]"),
      ].map((glyph) => glyph.getAttribute("data-discern-theme-destination")),
    })),
    namesStorage: html.includes(`"${THEME_STORAGE_KEY}"`),
  };
  dom.window.close();
  return markup;
}

let served: Promise<readonly ThemeMarkup[]> | undefined;

/** The theme markup of every live HTML route, rendered once for the file. */
function everyRoute(): Promise<readonly ThemeMarkup[]> {
  served ??= (async () => {
    const routes = liveHtmlRoutes(await loadDocsSite());
    return await Promise.all(routes.map(async (route) => {
      const response = await handler(
        new Request(`https://discern.sh${route}`, { headers: BROWSER }),
      );
      return themeMarkup(route, await response.text());
    }));
  })();
  return served;
}

/** Run the bootstrap against a root that starts where the markup leaves it. */
function bootstrapped(
  bootstrap: string,
  stored: string | null,
): string | undefined {
  const dom = new JSDOM(
    `<html data-discern-theme="system"><body></body></html>`,
    { runScripts: "outside-only", url: "https://discern.sh/" },
  );
  const window = dom.window as unknown as ThemeWindow;
  if (stored === null) window.localStorage.removeItem(THEME_STORAGE_KEY);
  else window.localStorage.setItem(THEME_STORAGE_KEY, stored);
  window.eval(bootstrap);
  const applied = window.document.documentElement.dataset.discernTheme;
  dom.window.close();
  return applied;
}

Deno.test("the homepage is dark for every reader, and every other route leaves its theme to the reader", async () => {
  const routes = await everyRoute();
  const dark = routes.filter((markup) => DARK_ROUTES.has(markup.route));
  const reader = routes.filter((markup) => !DARK_ROUTES.has(markup.route));
  assertEquals(
    dark.map((markup) => markup.route).sort(),
    [...DARK_ROUTES].sort(),
    "every dark route is live",
  );
  assert(reader.length > 0, "the site has routes whose theme is the reader's");

  for (const markup of reader) {
    const [light, night, ...more] = markup.chrome;
    assert(
      light?.endsWith(` when ${SCHEME.light}`) &&
        night?.endsWith(` when ${SCHEME.dark}`) && more.length === 0,
      `${markup.route}: the browser's chrome follows the device, as ${markup.chrome}`,
    );
    assertEquals(
      { ...markup, chrome: [], bootstraps: markup.bootstraps.length },
      {
        route: markup.route,
        tokenRoot: true,
        theme: "system",
        storageKey: THEME_STORAGE_KEY,
        chrome: [],
        bootstraps: 1,
        // A control names its destination, carries no pressed state, and
        // stays inert until the package behavior activates it.
        controls: [{
          pressed: null,
          inert: true,
          destinations: ["dark", "light"],
        }],
        namesStorage: true,
      },
    );
  }

  // The chrome colour a reader's route pairs with a dark device.
  const nightChrome = reader[0]?.chrome[1]?.split(" when ")[0];
  for (const markup of dark) {
    assertEquals(markup, {
      route: markup.route,
      tokenRoot: true,
      // Dark in the server's markup, so it needs no script and no device
      // setting to be dark from the first paint.
      theme: "dark",
      storageKey: null,
      chrome: [`${nightChrome} when always`],
      bootstraps: [],
      controls: [],
      namesStorage: false,
    });
  }
});

Deno.test("every reader's shell shares one bootstrap that applies only a stored choice", async () => {
  const bootstraps = (await everyRoute()).flatMap((markup) =>
    markup.bootstraps
  );
  const [bootstrap = ""] = bootstraps;
  // A page the build formats and a page rendered on request carry one script.
  const withoutFormatting = (source: string) => source.replaceAll(/[\s;]/g, "");
  assertEquals(
    [...new Set(bootstraps.map(withoutFormatting))],
    [withoutFormatting(bootstrap)],
  );
  assertStringIncludes(bootstrap, THEME_STORAGE_KEY);

  assertEquals(bootstrapped(bootstrap, "dark"), "dark");
  assertEquals(bootstrapped(bootstrap, "light"), "light");
  assertEquals(
    bootstrapped(bootstrap, null),
    "system",
    "with nothing stored the emitted stylesheet follows the device",
  );
  assertEquals(
    bootstrapped(bootstrap, "sideways"),
    "system",
    "an unusable stored value never reaches the root",
  );
});

Deno.test("every drawn shell icon states its own paint and follows the text colour", () => {
  const entries = Object.entries(icons).map(([name, Icon]) =>
    [name, renderToStaticMarkup(createElement(Icon))] as const
  );
  assert(entries.length > 0);
  for (const [name, markup] of entries) {
    assertStringIncludes(markup, 'fill="none"', name);
    assertStringIncludes(markup, 'stroke="currentColor"', name);
    assert(
      /stroke-width="/.test(markup),
      `${name}: a line graphic states its stroke width`,
    );
  }
});
