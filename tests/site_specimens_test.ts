/** Contracts for the development-only homepage artefact specimen sheet. */

import { assert, assertEquals, assertStringIncludes } from "@std/assert";
// @ts-types="@types/jsdom"
import { JSDOM } from "jsdom";
import { renderSpecimens } from "../site/page-src/specimens.tsx";
import {
  SPECIMEN_STYLESHEET_PATH,
  specimenHandler,
} from "../site/specimens.ts";
import { handler, PAGES } from "../site/serve.ts";

const SPECIMEN_CSS = new URL(
  "../site/page-src/specimens.css",
  import.meta.url,
);

/** Collapse rendered prose whitespace without changing punctuation or code text. */
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

Deno.test("the specimen sheet remains outside the public route registry", async () => {
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

Deno.test("the development handler serves only the sheet and its live stylesheet", async () => {
  const root = await specimenHandler(new Request("http://localhost/"));
  assertEquals(root.status, 200);
  assertStringIncludes(root.headers.get("content-type") ?? "", "text/html");
  assertEquals(root.headers.get("cache-control"), "no-store");
  assertEquals(root.headers.get("x-robots-tag"), "noindex, nofollow");
  assertStringIncludes(await root.text(), "The delegation wave plan");

  const stylesheet = await specimenHandler(
    new Request(`http://localhost${SPECIMEN_STYLESHEET_PATH}`),
  );
  assertEquals(stylesheet.status, 200);
  assertStringIncludes(
    stylesheet.headers.get("content-type") ?? "",
    "text/css",
  );
  assertEquals(stylesheet.headers.get("cache-control"), "no-store");
  assertStringIncludes(await stylesheet.text(), ".specimen-theme");

  for (const path of ["/", SPECIMEN_STYLESHEET_PATH]) {
    const rejected = await specimenHandler(
      new Request(`http://localhost${path}`, { method: "POST" }),
    );
    assertEquals(rejected.status, 405, path);
    assertEquals(rejected.headers.get("allow"), "GET, HEAD", path);
    await rejected.body?.cancel();
  }
});

Deno.test("all four truthful artefacts render once in each fixed theme", () => {
  const html = renderSpecimens();
  const dom = new JSDOM(html);
  const document = dom.window.document;

  assertEquals(document.querySelectorAll("h1").length, 1);
  assertEquals(document.querySelectorAll(".specimen-section").length, 4);
  assertEquals(document.querySelectorAll(".specimen-theme").length, 8);
  assertEquals(
    document.querySelectorAll('.specimen-theme[data-discern-theme="light"]')
      .length,
    4,
  );
  assertEquals(
    document.querySelectorAll('.specimen-theme[data-discern-theme="dark"]')
      .length,
    4,
  );

  const ids = [...document.querySelectorAll("[id]")].map((element) =>
    element.id
  );
  assertEquals(ids.length, new Set(ids).size, "rendered ids must be unique");

  const text = readableText(document.body.textContent);
  for (const handoff of document.querySelectorAll(".wave-handoff")) {
    assertEquals(
      [...handoff.children].map((element) => readableText(element.textContent))
        .join(" "),
      "1A lands → desk-1b updates → 1B lands",
    );
  }
  for (
    const required of [
      "desk-1a",
      "desk-1b",
      "desk-2a",
      "desk-3a",
      "desk-4a",
      "desk-5a",
      "desk-6a",
      "desk-7a",
      "desk-8a",
      "desk-9a",
      "repository study",
      "fresh-worktree probe passed",
      "Missing dependencies are proposed before they are installed.",
      "31 → 25",
      "471 readings across 12 days and 40 attributed setup or release configurations.",
      "Internal snapshot, not a customer benchmark.",
      "agent/homepage-1a-b9ab45",
      "9457535abebe",
      "9 configured jobs",
      "security or absence of defects",
      "permission to land",
    ]
  ) assertStringIncludes(text, required);

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

Deno.test("specimen typography reserves monospace for the name and code", async () => {
  const css = await Deno.readTextFile(SPECIMEN_CSS);
  assertEquals(monoSelectors(css), [
    ".specimen-brand-name",
    ".wave-task code, .wave-spine code, .wave-handoff code",
    ".commissioning-stages__body code",
    ".proof-receipt__header code, .proof-line code, .proof-tree code, .proof-jobs code, .proof-standard-summary code, .proof-boundary code, .proof-source code",
  ]);
});
