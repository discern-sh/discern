/** Structural contracts for the development-only invariant-core study. */

import { assert, assertEquals, assertStringIncludes } from "@std/assert";
// @ts-types="@types/jsdom"
import { JSDOM } from "jsdom";
import { renderFreedomInvariantPreview } from "../site/page-src/benefit-freedom-invariant-preview.tsx";

const STUDY_CSS = new URL(
  "../site/page-src/benefit-freedom-invariant.css",
  import.meta.url,
);

/** Collapse rendered prose whitespace without changing punctuation. */
function readableText(value: string | null): string {
  return (value ?? "").replace(/\s+/g, " ").trim();
}

Deno.test("the Freedom of movement study renders one fixed invariant in each theme", () => {
  const dom = new JSDOM(renderFreedomInvariantPreview());
  const document = dom.window.document;

  assertEquals(
    readableText(document.querySelector("h1")?.textContent ?? null),
    "Freedom of movement",
  );
  assertEquals(
    readableText(
      document.querySelector(".freedom-invariant__caption")?.textContent ??
        null,
    ),
    "Nothing about the practice binds the project to one agent vendor, one stack, or to discern itself.",
  );

  const themes = [...document.querySelectorAll(".freedom-invariant__theme")];
  assertEquals(themes.length, 2);
  assertEquals(
    themes.map((theme) => theme.getAttribute("data-discern-theme")),
    ["light", "dark"],
  );

  const renderedIds = [...document.querySelectorAll("[id]")].map((element) =>
    element.id
  );
  assertEquals(
    renderedIds.length,
    new Set(renderedIds).size,
    "the paired SVG accessibility IDs must remain unique",
  );

  for (const theme of themes) {
    const svg = theme.querySelector("svg[role='img']");
    assert(svg !== null);
    const title = svg.querySelector("title");
    const description = svg.querySelector("desc");
    assert(title?.id);
    assert(description?.id);
    assertEquals(
      svg.getAttribute("aria-labelledby"),
      `${title.id} ${description.id}`,
    );
    assertStringIncludes(readableText(title.textContent), "invariant core");
    assertStringIncludes(
      readableText(description.textContent),
      "remains fixed",
    );

    const apparatus = svg.querySelector("[data-transforming-apparatus]");
    const core = svg.querySelector("[data-invariant-core]");
    assert(apparatus !== null);
    assert(core !== null);
    assertEquals(apparatus.querySelector("[data-invariant-core]"), null);
    assertEquals(
      [...apparatus.querySelectorAll("[data-coordinate-frame]")].map(
        (frame) => frame.getAttribute("data-coordinate-frame"),
      ),
      ["cartesian", "oblique", "radial"],
    );
    assertEquals(svg.querySelectorAll("text").length, 0);
  }

  assertEquals(
    [...document.querySelectorAll<HTMLScriptElement>("script[src]")].map(
      (script) => script.getAttribute("src"),
    ),
    ["/assets/theme.js"],
    "the static study must not ship a browser framework runtime",
  );
  dom.window.close();
});

Deno.test("the coordinate transformation has a complete reduced-motion state", async () => {
  const css = await Deno.readTextFile(STUDY_CSS);
  for (
    const keyframes of [
      "freedom-invariant-cartesian",
      "freedom-invariant-oblique",
      "freedom-invariant-radial",
    ]
  ) {
    assertStringIncludes(css, `@keyframes ${keyframes}`);
    assertStringIncludes(css, `animation: ${keyframes} 11s`);
  }

  const reducedMotionStart = css.indexOf(
    "@media (prefers-reduced-motion: reduce)",
  );
  assert(reducedMotionStart >= 0);
  const reducedMotion = css.slice(reducedMotionStart);
  assertStringIncludes(reducedMotion, ".freedom-invariant__frame--cartesian");
  assertStringIncludes(reducedMotion, ".freedom-invariant__frame--oblique");
  assertStringIncludes(reducedMotion, ".freedom-invariant__frame--radial");
  assertStringIncludes(reducedMotion, ".freedom-invariant__bloom");
  assertStringIncludes(reducedMotion, "animation: none;");
  assertStringIncludes(reducedMotion, "transform: none;");
});
