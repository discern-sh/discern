/** Contracts for the development-only bifurcation benefit-art study. */

import { assert, assertEquals, assertStringIncludes } from "@std/assert";
// @ts-types="@types/jsdom"
import { JSDOM } from "jsdom";
import { renderBifurcationSpecimen } from "../site/page-src/benefit-art-bifurcation-preview.tsx";
import {
  SPECIMEN_STYLESHEET_PATH,
  specimenHandler,
} from "../site/specimens.ts";
import { handler, PAGES } from "../site/serve.ts";

const BIFURCATION_CSS = new URL(
  "../site/page-src/benefit-art-bifurcation.css",
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

Deno.test("the development handler serves the focused study and live CSS", async () => {
  const root = await specimenHandler(new Request("http://localhost/"));
  assertEquals(root.status, 200);
  assertStringIncludes(root.headers.get("content-type") ?? "", "text/html");
  assertEquals(root.headers.get("cache-control"), "no-store");
  assertEquals(root.headers.get("x-robots-tag"), "noindex, nofollow");
  assertStringIncludes(await root.text(), "Multiply your output.");

  const stylesheet = await specimenHandler(
    new Request(`http://localhost${SPECIMEN_STYLESHEET_PATH}`),
  );
  assertEquals(stylesheet.status, 200);
  assertStringIncludes(
    stylesheet.headers.get("content-type") ?? "",
    "text/css",
  );
  assertEquals(stylesheet.headers.get("cache-control"), "no-store");
  assertStringIncludes(await stylesheet.text(), ".bifurcation-art");

  for (const path of ["/", SPECIMEN_STYLESHEET_PATH]) {
    const rejected = await specimenHandler(
      new Request(`http://localhost${path}`, { method: "POST" }),
    );
    assertEquals(rejected.status, 405, path);
    assertEquals(rejected.headers.get("allow"), "GET, HEAD", path);
    await rejected.body?.cancel();
  }
});

Deno.test("one bifurcation study renders in both fixed themes", () => {
  const html = renderBifurcationSpecimen();
  const dom = new JSDOM(html);
  const document = dom.window.document;

  assertEquals(document.querySelectorAll("h1").length, 1);
  assertEquals(
    document.querySelectorAll(".benefit-art-preview__theme").length,
    2,
  );
  assertEquals(
    document.querySelectorAll(
      '.benefit-art-preview__theme[data-discern-theme="light"]',
    ).length,
    1,
  );
  assertEquals(
    document.querySelectorAll(
      '.benefit-art-preview__theme[data-discern-theme="dark"]',
    ).length,
    1,
  );

  for (
    const theme of document.querySelectorAll(".benefit-art-preview__theme")
  ) {
    assertEquals(theme.querySelectorAll(".bifurcation-art > svg").length, 1);
    assertEquals(
      theme.querySelectorAll("[data-bifurcation-trajectory]").length,
      5,
    );
    assertEquals(
      theme.querySelectorAll("[data-bifurcation-motion]").length,
      13,
    );
  }

  const ids = [...document.querySelectorAll("[id]")].map((element) =>
    element.id
  );
  assertEquals(ids.length, new Set(ids).size, "rendered ids must be unique");

  const text = readableText(document.body.textContent);
  assertStringIncludes(text, "Multiply your output.");
  assertStringIncludes(
    text,
    "Isolation, delegation shapes, and fleet coordination raise how much work can be in flight at once.",
  );
  assert(!html.includes("_private"), "private source paths must not render");
  assertEquals(
    [...document.querySelectorAll<HTMLScriptElement>("script[src]")].map(
      (script) => script.getAttribute("src"),
    ),
    ["/assets/theme.js"],
    "the static preview must not ship a browser framework runtime",
  );
  dom.window.close();
});

Deno.test("each artwork has a local title and description", () => {
  const dom = new JSDOM(renderBifurcationSpecimen());
  const document = dom.window.document;

  for (const svg of document.querySelectorAll(".bifurcation-art svg")) {
    assertEquals(svg.getAttribute("role"), "img");
    const labelledBy = (svg.getAttribute("aria-labelledby") ?? "").split(
      /\s+/,
    ).filter(Boolean);
    assertEquals(labelledBy.length, 2);

    const title = document.getElementById(labelledBy[0] ?? "");
    const description = document.getElementById(labelledBy[1] ?? "");
    assertEquals(title?.tagName.toLowerCase(), "title");
    assertEquals(description?.tagName.toLowerCase(), "desc");
    assert(readableText(title?.textContent ?? null).length > 0);
    assert(readableText(description?.textContent ?? null).length > 0);
  }
  dom.window.close();
});

Deno.test("the artwork keeps its culmination when motion is reduced", async () => {
  const css = await Deno.readTextFile(BIFURCATION_CSS);
  assertStringIncludes(css, "animation-duration: 10.8s");
  assertStringIncludes(css, "@media (prefers-reduced-motion: reduce)");
  assertStringIncludes(
    css,
    ".bifurcation-art [data-bifurcation-motion] {\n      animation: none;",
  );
  assertStringIncludes(css, "stroke-dashoffset: 0");
  assertStringIncludes(css, "transform: none");
});

Deno.test("the study reserves monospace for the product name", async () => {
  const css = await Deno.readTextFile(BIFURCATION_CSS);
  assertEquals(monoSelectors(css), [".benefit-art-preview__brand"]);
});
