/** Contracts for the development-only benefit artwork specimen. */

import { assert, assertEquals, assertStringIncludes } from "@std/assert";
// @ts-types="@types/jsdom"
import { JSDOM } from "jsdom";
import { renderSpecimens } from "../site/page-src/specimens.tsx";
import {
  ALIGNMENT_STYLESHEET_PATH,
  SPECIMEN_STYLESHEET_PATH,
  specimenHandler,
} from "../site/specimens.ts";
import { handler, PAGES } from "../site/serve.ts";

const SPECIMEN_CSS = new URL(
  "../site/page-src/specimens.css",
  import.meta.url,
);
const ALIGNMENT_CSS = new URL(
  "../site/page-src/benefit_alignment.css",
  import.meta.url,
);

/** Collapse rendered prose whitespace without changing punctuation. */
function readableText(value: string | null): string {
  return (value ?? "").replace(/\s+/g, " ").trim();
}

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

Deno.test("the benefit specimen remains outside the public route registry", async () => {
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

Deno.test("the development handler serves the study and both live stylesheets", async () => {
  const root = await specimenHandler(new Request("http://localhost/"));
  assertEquals(root.status, 200);
  assertStringIncludes(root.headers.get("content-type") ?? "", "text/html");
  assertEquals(root.headers.get("cache-control"), "no-store");
  assertEquals(root.headers.get("x-robots-tag"), "noindex, nofollow");
  assertStringIncludes(await root.text(), "Delegate with confidence.");

  for (
    const [path, selector] of [
      [SPECIMEN_STYLESHEET_PATH, ".specimen-theme"],
      [ALIGNMENT_STYLESHEET_PATH, ".benefit-alignment"],
    ] as const
  ) {
    const stylesheet = await specimenHandler(
      new Request(`http://localhost${path}`),
    );
    assertEquals(stylesheet.status, 200, path);
    assertStringIncludes(
      stylesheet.headers.get("content-type") ?? "",
      "text/css",
    );
    assertEquals(stylesheet.headers.get("cache-control"), "no-store");
    assertStringIncludes(await stylesheet.text(), selector);
  }

  for (
    const path of [
      "/",
      SPECIMEN_STYLESHEET_PATH,
      ALIGNMENT_STYLESHEET_PATH,
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

Deno.test("the focused alignment study renders once in each fixed theme", () => {
  const html = renderSpecimens();
  const dom = new JSDOM(html);
  const document = dom.window.document;

  assertEquals(document.querySelectorAll("h1").length, 1);
  assertEquals(
    readableText(document.querySelector("h1")?.textContent ?? null),
    "Delegate with confidence.",
  );
  assertEquals(document.querySelectorAll(".specimen-theme").length, 2);
  assertEquals(
    document.querySelectorAll('.specimen-theme[data-discern-theme="light"]')
      .length,
    1,
  );
  assertEquals(
    document.querySelectorAll('.specimen-theme[data-discern-theme="dark"]')
      .length,
    1,
  );
  assertEquals(document.querySelectorAll(".benefit-alignment").length, 2);

  const ids = [...document.querySelectorAll("[id]")].map((element) =>
    element.id
  );
  assertEquals(ids.length, new Set(ids).size, "rendered ids must be unique");

  assertStringIncludes(
    readableText(document.body.textContent),
    "Correctness, permission, and blast radius are held by separate mechanisms, so delegated work is verified rather than taken on trust.",
  );
  assertEquals(
    [...document.querySelectorAll<HTMLScriptElement>("script[src]")].map(
      (script) => script.getAttribute("src"),
    ),
    ["/assets/theme.js"],
    "the static preview must not ship a browser framework runtime",
  );
  dom.window.close();
});

Deno.test("alignment artwork names its final state and motion alternative", async () => {
  const dom = new JSDOM(renderSpecimens());
  const document = dom.window.document;
  const artworks = document.querySelectorAll<SVGElement>(
    ".benefit-alignment__art",
  );
  assertEquals(artworks.length, 2);

  for (const artwork of artworks) {
    assertEquals(artwork.getAttribute("role"), "img");
    const labelledBy = artwork.getAttribute("aria-labelledby")?.split(/\s+/) ??
      [];
    assertEquals(labelledBy.length, 2);
    const [titleId, descriptionId] = labelledBy;
    assert(titleId !== undefined);
    assert(descriptionId !== undefined);
    assertEquals(
      readableText(document.getElementById(titleId)?.textContent ?? null),
      "Planes resolving into exact alignment",
    );
    const description = readableText(
      document.getElementById(descriptionId)?.textContent ?? null,
    );
    assertStringIncludes(description, "a separate condition");
    assertStringIncludes(description, "remains visible without motion");
    assertEquals(artwork.querySelectorAll("[data-alignment-plane]").length, 3);
    assertEquals(
      artwork.querySelectorAll("[data-alignment-aperture]").length,
      1,
    );
  }
  dom.window.close();

  const css = await Deno.readTextFile(ALIGNMENT_CSS);
  assertStringIncludes(css, "@media (prefers-reduced-motion: reduce)");
  assertStringIncludes(css, ".benefit-alignment__plane,");
  assertStringIncludes(css, ".benefit-alignment__aperture,");
  assertStringIncludes(css, ".benefit-alignment__bloom {");
  assertStringIncludes(css, "animation: none;");
  assertStringIncludes(css, "10.5s");
});

Deno.test("specimen typography reserves monospace for the product name", async () => {
  const specimenCss = await Deno.readTextFile(SPECIMEN_CSS);
  const alignmentCss = await Deno.readTextFile(ALIGNMENT_CSS);
  assertEquals(monoSelectors(`${specimenCss}\n${alignmentCss}`), [
    ".specimen-brand-name",
  ]);
});
