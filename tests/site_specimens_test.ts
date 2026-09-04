/** Contracts for the development-only homepage artefact specimen sheet. */

import { assert, assertEquals, assertStringIncludes } from "@std/assert";
import { z } from "@zod/zod";
// @ts-types="@types/jsdom"
import { JSDOM } from "jsdom";
import { renderSpecimens } from "../site/page-src/specimens.tsx";
import {
  SPECIMEN_STYLESHEET_PATH,
  specimenHandler,
} from "../site/specimens.ts";
import { handler, PAGES } from "../site/serve.ts";
import { decodeWith } from "./decode_cli_result.ts";

const DenoTasksSchema = z.object({
  tasks: z.record(z.string(), z.string()).optional(),
});

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

/** Find callout markers that have drifted outside the section they name. */
function misplacedProofMarkers(document: Document): string[] {
  return [...document.querySelectorAll<HTMLElement>(".proof-pin")].flatMap(
    (marker) => {
      const target = marker.dataset.proofTarget;
      const section = marker.closest<HTMLElement>("[data-proof-section]");
      return target !== undefined && section?.dataset.proofSection === target
        ? []
        : [readableText(marker.textContent)];
    },
  );
}

Deno.test("the specimen sheet remains outside the public route registry", async () => {
  assertEquals(Object.hasOwn(PAGES, "/specimens"), false);
  const publicResponse = await handler(
    new Request("https://discern.sh/specimens"),
  );
  assertEquals(publicResponse.status, 404);
  await publicResponse.body?.cancel();

  const config = decodeWith(
    DenoTasksSchema,
    await Deno.readTextFile(new URL("../deno.json", import.meta.url)),
  );
  assertEquals(
    config.tasks?.["site:specimens"],
    "deno run --allow-read --allow-run --allow-net=127.0.0.1 --allow-env=NODE_ENV,PORT,DISCERN_PROJECT_SLUG,DISCERN_TRUNK,DISCERN_WORKTREE_BRANCH_PREFIX,DISCERN_WORKTREE_ID,GIT_BIN site/specimens.ts",
  );
});

Deno.test("the development handler preserves the homepage specimen sheet", async () => {
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
    document.querySelectorAll(".specimen-theme[data-discern-accent]").length,
    8,
  );
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
  for (
    const theme of document.querySelectorAll("#delegation .specimen-theme")
  ) {
    assertEquals(
      [...theme.querySelectorAll(".wave-handoff")].map((handoff) =>
        [...handoff.children].map((element) =>
          readableText(element.textContent)
        ).join(" ")
      ),
      ["Wave 1 lands ↓ Wave 2 opens", "Wave 2 lands ↓ Wave 3 opens"],
    );
  }
  assertEquals(
    document.querySelectorAll("#delegation .delegation-wave").length,
    6,
  );
  assertEquals(document.querySelectorAll("#delegation .wave-task").length, 10);
  for (
    const required of [
      "Open the project to beta users",
      "beta-onboarding",
      "beta-feedback",
      "beta-journey",
      "beta-accessibility",
      "beta-invitation",
      "Illustrative homepage plan.",
      "Your agent studies the project",
      "Your agent presents their findings",
      "They’ll ask you to confirm a few details about your project before they continue.",
      "They prove it works in a fresh workspace",
      "New tools need your approval. Nothing is installed without it.",
      "31 → 25",
      "471 readings across 12 days and 40 attributed setup or release configurations.",
      "Internal snapshot, not a customer benchmark.",
      "agent/homepage-1a-b9ab45",
      "9457535abebe",
      "9 configured jobs",
      "The owner still decides whether the change may land.",
    ]
  ) assertStringIncludes(text, required);

  assert(!text.includes("It does not claim"));
  assert(!text.includes("Desk UX"));
  assert(!text.includes("Output ·"));
  assert(!text.includes("Example subject ·"));
  assertEquals(
    document.querySelectorAll('#proof [aria-label="Figure legend"]').length,
    0,
  );
  assertEquals(
    document.querySelectorAll(
      '#commissioning [aria-label="Figure legend"]',
    ).length,
    0,
  );
  assertEquals(
    document.querySelectorAll('#delegation [aria-label="Figure legend"]')
      .length,
    0,
  );
  assertEquals(
    readableText(
      document.querySelector("#standard .standard-trajectory__status")
        ?.textContent ?? null,
    ),
    "Lower is better. Every authored Deno source file is enrolled.",
  );
  assert(!text.includes("Internal dogfooding"));
  assert(!text.toLowerCase().includes("observational"));

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

Deno.test("Proof markers stay inside the section they annotate", () => {
  const rendered = new JSDOM(renderSpecimens());
  assertEquals(misplacedProofMarkers(rendered.window.document), []);
  rendered.window.close();

  const futureSibling = new JSDOM(`
    <section data-proof-section="tree">
      <span class="proof-pin" data-proof-target="gate">02</span>
    </section>
  `);
  assertEquals(
    misplacedProofMarkers(futureSibling.window.document),
    ["02"],
    "a new marker must live inside the section named by its target",
  );
  futureSibling.window.close();
});

Deno.test("the Proof specimen uses the canonical CommonMark semantics", () => {
  const rendered = new JSDOM(renderSpecimens());
  const proofLine = rendered.window.document.querySelector(".proof-line");
  assertEquals(proofLine?.tagName, "BLOCKQUOTE");
  assertEquals(proofLine?.querySelector("strong")?.textContent, "Proof:");
  assertEquals(proofLine?.querySelectorAll("code").length, 4);
  assertStringIncludes(
    readableText(proofLine?.textContent ?? null),
    "The Gate passed for agent/homepage-1a-b9ab45 at 9457535abebe",
  );
  rendered.window.close();
});

Deno.test("specimen typography reserves monospace for the name and code", async () => {
  const css = await Deno.readTextFile(SPECIMEN_CSS);
  assertEquals(monoSelectors(css), [
    ".specimen-brand-name",
    ".wave-task code",
    ".proof-card__header code, .proof-line code, .proof-tree code, .proof-jobs code, .proof-standard-summary code, .proof-boundary code, .proof-source code",
  ]);
});
