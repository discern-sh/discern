import { assertEquals, assertStringIncludes } from "@std/assert";
// @ts-types="@types/jsdom"
import { JSDOM } from "jsdom";
import { handler } from "../site/serve.ts";

const BROWSER = {
  accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
  "user-agent": "Mozilla/5.0 theme contract",
};

interface ThemeMedia {
  matches: boolean;
  addEventListener(
    type: "change",
    listener: (event: { matches: boolean }) => void,
  ): void;
}

interface ThemeWindow extends Window {
  eval(source: string): unknown;
}

/** Return the inline theme bootstrap. */
function inlineThemeBootstrap(html: string): string {
  const scripts = [
    ...html.matchAll(/<script(?: [^>]*)?>([\s\S]*?)<\/script>/g),
  ];
  return (scripts.find((match) =>
    (match[1] ?? "").includes("prefers-color-scheme")
  )?.[1] ?? "").trim();
}

Deno.test("homepage and docs share one system-aware theme bootstrap", async () => {
  const [home, docs] = await Promise.all([
    handler(new Request("https://discern.sh/", { headers: BROWSER })),
    handler(new Request("https://discern.sh/docs", { headers: BROWSER })),
  ]);
  const homeHtml = await home.text();
  const docsHtml = await docs.text();
  const homeBootstrap = inlineThemeBootstrap(homeHtml);
  const withoutFormatting = (source: string) => source.replaceAll(/[\s;]/g, "");
  assertEquals(
    withoutFormatting(inlineThemeBootstrap(docsHtml)),
    withoutFormatting(homeBootstrap),
  );
  assertStringIncludes(homeBootstrap, "prefers-color-scheme: dark");
  assertStringIncludes(homeBootstrap, "discern-theme");
  assertStringIncludes(homeHtml, 'src="/assets/theme.js"');
  assertStringIncludes(docsHtml, 'src="/assets/theme.js"');
});

Deno.test("theme controls follow the system until either fresh-name control overrides it", async () => {
  const client = await Deno.readTextFile(
    new URL("../site/pages/assets/theme.js", import.meta.url),
  );
  const dom = new JSDOM(
    `<html data-discern-theme="light"><body>
      <button class="unrelated-alpha" data-theme-toggle><span data-theme-label></span></button>
      <button class="future-beta" data-theme-toggle></button>
    </body></html>`,
    { runScripts: "outside-only", url: "https://discern.sh/" },
  );
  const window = dom.window as unknown as ThemeWindow;
  let mediaListener: ((event: { matches: boolean }) => void) | undefined;
  const media: ThemeMedia = {
    matches: true,
    addEventListener: (_type, listener) => {
      mediaListener = listener;
    },
  };
  Object.defineProperty(window, "matchMedia", { value: () => media });
  window.eval(client);

  const controls = [...window.document.querySelectorAll<HTMLButtonElement>(
    "[data-theme-toggle]",
  )];
  assertEquals(window.document.documentElement.dataset.discernTheme, "dark");
  assertEquals(
    controls.map((control) => control.getAttribute("aria-label")),
    ["Switch to the light theme", "Switch to the light theme"],
  );
  assertEquals(
    controls.map((control) => control.getAttribute("aria-pressed")),
    ["true", "true"],
  );
  assertEquals(
    window.document.querySelector("[data-theme-label]")?.textContent,
    "Light",
  );

  controls[1]?.click();
  assertEquals(window.document.documentElement.dataset.discernTheme, "light");
  assertEquals(window.localStorage.getItem("discern-theme"), "light");
  assertEquals(
    controls.map((control) => control.getAttribute("aria-label")),
    ["Switch to the dark theme", "Switch to the dark theme"],
  );

  media.matches = false;
  mediaListener?.({ matches: false });
  assertEquals(
    window.document.documentElement.dataset.discernTheme,
    "light",
    "a stored user override wins over later system changes",
  );
  dom.window.close();
});

Deno.test("an unoverridden page tracks a system theme change", async () => {
  const client = await Deno.readTextFile(
    new URL("../site/pages/assets/theme.js", import.meta.url),
  );
  const dom = new JSDOM(
    `<html data-discern-theme="light"><body><button data-theme-toggle></button></body></html>`,
    { runScripts: "outside-only", url: "https://discern.sh/docs" },
  );
  const window = dom.window as unknown as ThemeWindow;
  const listeners: Array<(event: { matches: boolean }) => void> = [];
  const media: ThemeMedia = {
    matches: false,
    addEventListener: (_type, listener) => listeners.push(listener),
  };
  Object.defineProperty(window, "matchMedia", { value: () => media });
  window.eval(client);
  assertEquals(window.document.documentElement.dataset.discernTheme, "light");
  media.matches = true;
  for (const listener of listeners) listener({ matches: true });
  assertEquals(window.document.documentElement.dataset.discernTheme, "dark");
  dom.window.close();
});
