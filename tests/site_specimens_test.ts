/** Contracts for the focused development-only benefit-art specimen sheet. */

import { assert, assertEquals, assertStringIncludes } from "@std/assert";
// @ts-types="@types/jsdom"
import { JSDOM } from "jsdom";
import { renderSpecimens } from "../site/page-src/specimens.tsx";
import {
  PERSISTENT_TRACE_STYLESHEET_PATH,
  SPECIMEN_STYLESHEET_PATH,
  specimenHandler,
} from "../site/specimens.ts";
import { handler, PAGES } from "../site/serve.ts";

const SPECIMEN_CSS = new URL(
  "../site/page-src/specimens.css",
  import.meta.url,
);

/** Return selectors whose declarations opt into the monospace token. */
function monoSelectors(css: string): string[] {
  const selectors: string[] = [];
  for (const match of css.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    const selector = match[1];
    const declarations = match[2];
    if (
      selector === undefined || declarations === undefined ||
      !declarations.includes("var(--discern-font-mono)")
    ) continue;
    selectors.push(selector.trim().replace(/\s+/g, " "));
  }
  return selectors;
}

Deno.test("the benefit-art study remains outside the public route registry", async () => {
  assertEquals(Object.hasOwn(PAGES, "/specimens"), false);
  const publicResponse = await handler(
    new Request("https://discern.sh/specimens"),
  );
  assertEquals(publicResponse.status, 404);
  await publicResponse.body?.cancel();

  const config = JSON.parse(
    await Deno.readTextFile(new URL("../deno.json", import.meta.url)),
  ) as { tasks?: Record<string, string> };
  assertEquals(
    config.tasks?.["site:specimens"],
    "deno run --allow-read --allow-run --allow-net=127.0.0.1 --allow-env=NODE_ENV,PORT,DISCERN_PROJECT_SLUG,DISCERN_WORKTREE_BRANCH_PREFIX,DISCERN_WORKTREE_ID,GIT_BIN site/specimens.ts",
  );
});

Deno.test("the development handler serves the study and its live styles", async () => {
  const root = await specimenHandler(new Request("http://localhost/"));
  assertEquals(root.status, 200);
  assertStringIncludes(root.headers.get("content-type") ?? "", "text/html");
  assertEquals(root.headers.get("cache-control"), "no-store");
  assertEquals(root.headers.get("x-robots-tag"), "noindex, nofollow");
  assertStringIncludes(await root.text(), "Knowledge that compounds");

  for (
    const stylesheetPath of [
      SPECIMEN_STYLESHEET_PATH,
      PERSISTENT_TRACE_STYLESHEET_PATH,
    ]
  ) {
    const stylesheet = await specimenHandler(
      new Request(`http://localhost${stylesheetPath}`),
    );
    assertEquals(stylesheet.status, 200, stylesheetPath);
    assertStringIncludes(
      stylesheet.headers.get("content-type") ?? "",
      "text/css",
    );
    assertEquals(stylesheet.headers.get("cache-control"), "no-store");
    assertStringIncludes(await stylesheet.text(), ".persistent-trace");
  }

  for (
    const path of [
      "/",
      SPECIMEN_STYLESHEET_PATH,
      PERSISTENT_TRACE_STYLESHEET_PATH,
    ]
  ) {
    const rejected = await specimenHandler(
      new Request(`http://localhost${path}`, { method: "POST" }),
    );
    assertEquals(rejected.status, 405, path);
    assertEquals(rejected.headers.get("allow"), "GET, HEAD", path);
    await rejected.body?.cancel();
  }
});

Deno.test("the focused study renders once in each fixed theme", () => {
  const html = renderSpecimens();
  const dom = new JSDOM(html);
  const document = dom.window.document;

  assertEquals(document.querySelectorAll("h1").length, 1);
  assertEquals(
    document.querySelector("h1")?.textContent,
    "Knowledge that compounds",
  );
  assertStringIncludes(
    document.body.textContent ?? "",
    "What one session learns, every later session and every configured agent inherits.",
  );
  assertEquals(
    document.querySelectorAll(".persistent-trace-demo__theme").length,
    2,
  );
  assertEquals(
    document.querySelectorAll(
      '.persistent-trace-demo__theme[data-discern-theme="light"]',
    ).length,
    1,
  );
  assertEquals(
    document.querySelectorAll(
      '.persistent-trace-demo__theme[data-discern-theme="dark"]',
    ).length,
    1,
  );
  assertEquals(document.querySelectorAll(".persistent-trace").length, 2);

  const ids = [...document.querySelectorAll("[id]")].map((element) =>
    element.id
  );
  assertEquals(ids.length, new Set(ids).size, "rendered ids must be unique");

  assertEquals(
    [...document.querySelectorAll<HTMLScriptElement>("script[src]")].map(
      (script) => script.getAttribute("src"),
    ),
    ["/assets/theme.js"],
    "the static preview must not ship a browser framework runtime",
  );
  assert(!html.includes("_private"), "private source paths must not render");
  dom.window.close();
});

Deno.test("specimen typography reserves monospace for the product name", async () => {
  const css = await Deno.readTextFile(SPECIMEN_CSS);
  assertEquals(monoSelectors(css), [
    ".persistent-trace-demo__brand-name",
  ]);
});
