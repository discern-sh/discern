/** The site owns first paint and storage policy; the package owns the control. */
import { assert, assertEquals, assertStringIncludes } from "@std/assert";
// @ts-types="@types/jsdom"
import { JSDOM } from "jsdom";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import * as icons from "../site/ui/components/DocumentIcons.tsx";
import { THEME_STORAGE_KEY } from "../site/theme.ts";
import { handler } from "../site/serve.ts";

const BROWSER = {
  accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
  "user-agent": "Mozilla/5.0 theme contract",
};

interface ThemeWindow extends Window {
  eval(source: string): unknown;
}

/** Select the inline script that applies a stored choice before the first paint. */
function inlineThemeBootstrap(html: string): string {
  const scripts = [
    ...html.matchAll(/<script(?: [^>]*)?>([\s\S]*?)<\/script>/g),
  ];
  return (scripts.find((match) => (match[1] ?? "").includes(THEME_STORAGE_KEY))
    ?.[1] ?? "").trim();
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

Deno.test("every shell shares one bootstrap that applies only a stored choice", async () => {
  const [home, docs] = await Promise.all([
    handler(new Request("https://discern.sh/", { headers: BROWSER })),
    handler(new Request("https://discern.sh/docs", { headers: BROWSER })),
  ]);
  const homeHtml = await home.text();
  const docsHtml = await docs.text();
  const bootstrap = inlineThemeBootstrap(homeHtml);
  const withoutFormatting = (source: string) => source.replaceAll(/[\s;]/g, "");
  assertEquals(
    withoutFormatting(inlineThemeBootstrap(docsHtml)),
    withoutFormatting(bootstrap),
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

Deno.test("public shells hand the package control an opted-in, named root", async () => {
  for (const route of ["/", "/docs", "/releases"]) {
    const html = await (await handler(
      new Request(`https://discern.sh${route}`, { headers: BROWSER }),
    )).text();
    const dom = new JSDOM(html);
    const root = dom.window.document.documentElement;
    assertEquals(root.dataset.discernThemeStorageKey, THEME_STORAGE_KEY, route);
    assert(root.hasAttribute("data-discern-root"), route);
    const control = dom.window.document.querySelector(
      "button[data-discern-theme-toggle]",
    );
    assert(control, `${route}: the shell renders the static theme control`);
    assertEquals(
      control.getAttribute("aria-pressed"),
      null,
      `${route}: the control names its destination rather than a pressed state`,
    );
    assert(
      control.hasAttribute("inert"),
      `${route}: the control stays inert until its behavior activates it`,
    );
    assertEquals(
      [...control.querySelectorAll("[data-discern-theme-destination]")].map(
        (glyph) => glyph.getAttribute("data-discern-theme-destination"),
      ),
      ["dark", "light"],
      `${route}: both destinations ship so the behavior can swap them`,
    );
    dom.window.close();
  }
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
