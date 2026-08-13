/** Structural guards for the quorum artwork's registered verdicts. */

import { assert, assertEquals } from "@std/assert";
// @ts-types="@types/jsdom"
import { JSDOM } from "jsdom";
import { QUORUM_SEATS } from "../art/browser/quorum.tsx";
import { renderArtGallery } from "../site/page-src/art-gallery.tsx";

const ARTWORK_CSS = new URL("../art/browser/quorum.css", import.meta.url);

/** Read one balanced keyframes body from authored CSS. */
function keyframesBody(css: string, name: string): string {
  const start = css.indexOf(`@keyframes ${name}`);
  assert(start >= 0, `${name} must exist`);
  const opening = css.indexOf("{", start);
  assert(opening >= 0, `${name} must open a body`);
  let depth = 1;
  let cursor = opening + 1;
  while (cursor < css.length && depth > 0) {
    if (css[cursor] === "{") depth += 1;
    if (css[cursor] === "}") depth -= 1;
    cursor += 1;
  }
  assertEquals(depth, 0, `${name} must close its body`);
  return css.slice(opening + 1, cursor - 1);
}

/** Map one keyframe offset to the declarations authored at that exact stage. */
function stageDeclarations(body: string, offset: string): Map<string, string> {
  for (const match of body.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    const selectors = (match[1] ?? "").split(",").map((value) => value.trim());
    if (!selectors.includes(offset)) continue;
    const declarations = new Map<string, string>();
    for (const declaration of (match[2] ?? "").split(";")) {
      const separator = declaration.indexOf(":");
      if (separator < 0) continue;
      declarations.set(
        declaration.slice(0, separator).trim(),
        declaration.slice(separator + 1).trim(),
      );
    }
    return declarations;
  }
  return new Map();
}

/** Find hold stages that let transform interpolate toward the hidden reset. */
function driftingHoldStages(body: string): string[] {
  return ["26%", "31%"].filter((offset) =>
    stageDeclarations(body, offset).get("transform") !== "scale(1)"
  );
}

Deno.test("quorum verdicts stay registered from fill through fade-out", async () => {
  const css = await Deno.readTextFile(ARTWORK_CSS);
  const verdict = keyframesBody(css, "fig-quorum-verdict");
  assertEquals(driftingHoldStages(verdict), []);

  const futureSibling = `
    0% { opacity: 0; transform: scale(0.72); }
    7% { transform: scale(1); }
    26% { opacity: 0.8; }
    31% { opacity: 0; }
    31.1%, 100% { opacity: 0; transform: scale(0.72); }
  `;
  assertEquals(
    driftingHoldStages(futureSibling),
    ["26%", "31%"],
    "the guard rejects the same backslide under an unrelated animation name",
  );

  const dom = new JSDOM(renderArtGallery());
  const figures = dom.window.document.querySelectorAll(".fig-quorum");
  assertEquals(figures.length, 2);
  for (const figure of figures) {
    assertEquals(
      figure.querySelectorAll(".fig-quorum__returns polygon").length,
      QUORUM_SEATS.length,
      "every current and future witness shares the guarded verdict animation",
    );
  }
  dom.window.close();
});
