/** Structural guards for the reusable persistent-trace benefit artwork. */

import {
  assert,
  assertEquals,
  assertMatch,
  assertStringIncludes,
} from "@std/assert";
// @ts-types="@types/jsdom"
import { JSDOM } from "jsdom";
import { renderSpecimens } from "../site/page-src/specimens.tsx";

const ARTWORK_CSS = new URL(
  "../site/page-src/benefit-persistent-trace.css",
  import.meta.url,
);

Deno.test("persistent-trace SVGs name the complete static composition", () => {
  const dom = new JSDOM(renderSpecimens());
  const artworks = dom.window.document.querySelectorAll<HTMLElement>(
    ".persistent-trace",
  );
  assertEquals(artworks.length, 2);

  for (const artwork of artworks) {
    const svg = artwork.querySelector<SVGElement>('svg[role="img"]');
    assert(svg !== null);

    const labelledBy = (svg.getAttribute("aria-labelledby") ?? "").split(
      /\s+/,
    ).filter(Boolean);
    assertEquals(labelledBy.length, 2);
    const [titleId, descriptionId] = labelledBy;
    assert(titleId !== undefined);
    assert(descriptionId !== undefined);

    const title = dom.window.document.getElementById(titleId);
    const description = dom.window.document.getElementById(descriptionId);
    assert(title !== null && artwork.contains(title));
    assert(description !== null && artwork.contains(description));
    assertStringIncludes(title.textContent ?? "", "Knowledge retained");
    assertStringIncludes(description.textContent ?? "", "Six plotted passes");

    const layers = [...svg.querySelectorAll<SVGPathElement>(
      "[data-persistent-layer]",
    )];
    assertEquals(layers.length, 6);
    assertEquals(
      layers.map((layer) => layer.getAttribute("data-persistent-layer")),
      ["1", "2", "3", "4", "5", "6"],
    );
    assertEquals(
      layers.map((layer) => layer.getAttribute("pathLength")),
      ["1", "1", "1", "1", "1", "1"],
    );
    assertEquals(svg.querySelectorAll(".persistent-trace__pass").length, 6);
    assertEquals(svg.querySelectorAll(".persistent-trace__traveler").length, 1);
    assertEquals(svg.querySelectorAll("animateMotion").length, 1);
    assertEquals(svg.querySelectorAll("text").length, 0);
  }

  dom.window.close();
});

Deno.test("persistent traces settle intact when reduced motion is requested", async () => {
  const css = await Deno.readTextFile(ARTWORK_CSS);
  assertStringIncludes(css, "@media (prefers-reduced-motion: reduce)");
  assertMatch(
    css,
    /\.persistent-trace__pass,[\s\S]*?\.persistent-trace__bloom\s*\{[\s\S]*?animation:\s*none;/,
  );
  assertMatch(
    css,
    /\.persistent-trace__draw,[\s\S]*?\.persistent-trace__traveler\s*\{[\s\S]*?display:\s*none;/,
  );
  for (let index = 1; index <= 6; index += 1) {
    assertStringIncludes(css, `@keyframes persistent-trace-pass-${index}`);
  }
});
