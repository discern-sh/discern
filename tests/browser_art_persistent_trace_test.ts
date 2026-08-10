/** Structural and geometric guards for the persistent-trace artwork. */

import {
  assert,
  assertAlmostEquals,
  assertEquals,
  assertMatch,
  assertStringIncludes,
} from "@std/assert";
// @ts-types="@types/jsdom"
import { JSDOM } from "jsdom";
import {
  PERSISTENT_TRACE_ARTBOARD,
  PERSISTENT_TRACE_CORE_POINTS,
  PERSISTENT_TRACE_POINTS,
  PERSISTENT_TRACE_ROUTE,
  PERSISTENT_TRACE_SEGMENTS,
} from "../art/browser/persistent-trace.tsx";
import { renderArtGallery } from "../site/page-src/art-gallery.tsx";

const ARTWORK_CSS = new URL(
  "../art/browser/persistent-trace.css",
  import.meta.url,
);

/** Return a point's radius in the artboard's normalized elliptical space. */
function normalizedRadius(
  point: { readonly x: number; readonly y: number },
): number {
  const { center, outerRadius } = PERSISTENT_TRACE_ARTBOARD;
  return Math.hypot(
    (point.x - center.x) / outerRadius.x,
    (point.y - center.y) / outerRadius.y,
  );
}

Deno.test("persistent-trace geometry stays centred, continuous, and balanced", () => {
  const { center, height, outerRadius, width } = PERSISTENT_TRACE_ARTBOARD;
  assertEquals(center.x, width / 2);
  assertEquals(center.y, height / 2);

  const coreCentroid = PERSISTENT_TRACE_CORE_POINTS.reduce(
    (sum, point) => ({ x: sum.x + point.x, y: sum.y + point.y }),
    { x: 0, y: 0 },
  );
  assertEquals(coreCentroid, { x: 0, y: 0 });

  const xs = PERSISTENT_TRACE_POINTS.map((point) => point.x);
  const ys = PERSISTENT_TRACE_POINTS.map((point) => point.y);
  const minimumX = Math.min(...xs);
  const maximumX = Math.max(...xs);
  const minimumY = Math.min(...ys);
  const maximumY = Math.max(...ys);
  assertAlmostEquals(center.x - minimumX, maximumX - center.x, 0.01);
  assertAlmostEquals(center.y - minimumY, maximumY - center.y, 0.01);
  assertAlmostEquals(center.x - minimumX, outerRadius.x, 0.01);
  assertAlmostEquals(center.y - minimumY, outerRadius.y, 0.01);

  const outerEnvelope = PERSISTENT_TRACE_POINTS.slice(0, 12);
  assertEquals(outerEnvelope.length, 12);
  for (const point of outerEnvelope) {
    assertAlmostEquals(normalizedRadius(point), 1, 0.0001);
  }

  const inwardPoints = PERSISTENT_TRACE_POINTS.slice(12);
  let previousRadius = Number.POSITIVE_INFINITY;
  for (const point of inwardPoints) {
    const radius = normalizedRadius(point);
    assert(
      radius <= previousRadius + 0.0001,
      `spiral radius increased from ${previousRadius} to ${radius}`,
    );
    previousRadius = radius;
  }

  const inwardTurns = PERSISTENT_TRACE_POINTS.slice(13, -1);
  assertEquals(inwardTurns.length, 48);
  for (let index = 0; index < 4; index += 1) {
    const turn = inwardTurns.slice(index * 12, (index + 1) * 12);
    const mean = turn.reduce(
      (sum, point) => ({
        x: sum.x + (point.x - center.x) / outerRadius.x,
        y: sum.y + (point.y - center.y) / outerRadius.y,
      }),
      { x: 0, y: 0 },
    );
    assert(
      Math.abs(mean.x / turn.length) < 0.04,
      `turn ${index + 1} drifted sideways`,
    );
    assert(
      Math.abs(mean.y / turn.length) < 0.02,
      `turn ${index + 1} became vertically weighted`,
    );
  }

  assertEquals(PERSISTENT_TRACE_SEGMENTS.length, 6);
  for (let index = 1; index < PERSISTENT_TRACE_SEGMENTS.length; index += 1) {
    const previous = PERSISTENT_TRACE_SEGMENTS[index - 1];
    const current = PERSISTENT_TRACE_SEGMENTS[index];
    assert(previous !== undefined);
    assert(current !== undefined);
    assertEquals(previous[previous.length - 1], current[0]);
  }

  const finalPoint =
    PERSISTENT_TRACE_POINTS[PERSISTENT_TRACE_POINTS.length - 1];
  assertEquals(finalPoint, center);
  assertStringIncludes(PERSISTENT_TRACE_ROUTE, `L ${center.x} ${center.y}`);
});

Deno.test("persistent-trace SVGs name the complete centred composition", () => {
  const dom = new JSDOM(renderArtGallery());
  const artworks = dom.window.document.querySelectorAll<HTMLElement>(
    ".persistent-trace",
  );
  assertEquals(artworks.length, 2);

  for (const artwork of artworks) {
    const svg = artwork.querySelector<SVGElement>('svg[role="img"]');
    assert(svg !== null);
    assertEquals(
      svg.getAttribute("data-center-x"),
      String(PERSISTENT_TRACE_ARTBOARD.center.x),
    );
    assertEquals(
      svg.getAttribute("data-center-y"),
      String(PERSISTENT_TRACE_ARTBOARD.center.y),
    );

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
    assertStringIncludes(title.textContent ?? "", "Persistent trace");
    assertStringIncludes(description.textContent ?? "", "exact centre");

    const layers = [...svg.querySelectorAll<SVGPathElement>(
      "[data-persistent-layer]",
    )];
    assertEquals(layers.length, 6);
    assertEquals(
      layers.map((layer) => layer.getAttribute("data-persistent-layer")),
      ["1", "2", "3", "4", "5", "6"],
    );
    assertEquals(svg.querySelectorAll("[data-persistent-route]").length, 1);

    const core = svg.querySelector("[data-persistent-core]");
    assert(core !== null);
    assertEquals(
      core.getAttribute("transform"),
      `translate(${PERSISTENT_TRACE_ARTBOARD.center.x} ${PERSISTENT_TRACE_ARTBOARD.center.y})`,
    );

    const motion = svg.querySelector("animateMotion");
    assert(motion !== null);
    assertEquals(motion.getAttribute("keyPoints"), "0;1;1");
    assertEquals(motion.getAttribute("keyTimes"), "0;0.84;1");
    assertEquals(svg.querySelectorAll("text").length, 0);
  }

  dom.window.close();
});

Deno.test("persistent traces keep a complete frame across motion boundaries", async () => {
  const css = await Deno.readTextFile(ARTWORK_CSS);
  assertStringIncludes(css, "@keyframes persistent-trace-activation");
  assertStringIncludes(css, "@keyframes persistent-trace-traveler");
  assertMatch(
    css,
    /@keyframes persistent-trace-traveler\s*\{[\s\S]*?0%,\s*100%\s*\{\s*opacity:\s*0;/,
  );

  assertStringIncludes(css, "@media (prefers-reduced-motion: reduce)");
  assertMatch(
    css,
    /\.persistent-trace__activation,[\s\S]*?\.persistent-trace__bloom\s*\{[\s\S]*?animation:\s*none;/,
  );
  assertMatch(
    css,
    /\.persistent-trace__activation,[\s\S]*?\.persistent-trace__bloom\s*\{[\s\S]*?display:\s*none;/,
  );
  assertMatch(
    css,
    /\.persistent-trace__drawing\s*\{[^}]*width:\s*100%;[^}]*height:\s*auto;/,
  );
  assert(!css.includes("min-width"));
  assertStringIncludes(css, "background: transparent");
});
