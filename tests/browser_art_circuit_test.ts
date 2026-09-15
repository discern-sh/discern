/** Structural and geometric guards for the circuit artwork. */

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
  CIRCUIT_EDGES,
  CIRCUIT_GEOMETRY,
  CIRCUIT_LEGS,
  CIRCUIT_VERTICES,
  type CircuitPoint,
} from "../art/browser/circuit.tsx";
import { renderArtGallery } from "../site/ui/pages/ArtGalleryPage.tsx";

const ARTWORK_CSS = new URL("../art/browser/circuit.css", import.meta.url);

/** Distance between two points. */
function distance(a: CircuitPoint, b: CircuitPoint): number {
  return Math.hypot(b.x - a.x, b.y - a.y);
}

/** Cross product magnitude of two direction vectors from shared origin. */
function cross(
  origin: CircuitPoint,
  first: CircuitPoint,
  second: CircuitPoint,
): number {
  return (first.x - origin.x) * (second.y - origin.y) -
    (first.y - origin.y) * (second.x - origin.x);
}

/** Every keyframes block's per-selector declarations, normalized for equality. */
function parsedKeyframes(css: string): Map<string, Map<string, string>> {
  const rules = new Map<string, Map<string, string>>();
  const pattern = /@keyframes\s+([\w-]+)\s*\{/g;
  for (
    let match = pattern.exec(css);
    match !== null;
    match = pattern.exec(css)
  ) {
    const name = match[1];
    assert(name !== undefined);
    let depth = 1;
    let index = pattern.lastIndex;
    while (index < css.length && depth > 0) {
      if (css[index] === "{") depth += 1;
      if (css[index] === "}") depth -= 1;
      index += 1;
    }
    const body = css.slice(pattern.lastIndex, index - 1);
    const frames = new Map<string, string>();
    const framePattern = /([\d.,%\s]+)\{([^}]*)\}/g;
    for (
      let frame = framePattern.exec(body);
      frame !== null;
      frame = framePattern.exec(body)
    ) {
      const declarations = (frame[2] ?? "")
        .split(";")
        .map((declaration) => declaration.replace(/\s+/g, " ").trim())
        .filter((declaration) => declaration.length > 0)
        .sort()
        .join("; ");
      for (const selector of (frame[1] ?? "").split(",")) {
        frames.set(selector.trim(), declarations);
      }
    }
    rules.set(name, frames);
  }
  return rules;
}

Deno.test("circuit geometry keeps one equilateral relay with shared margins", () => {
  const { centroid, circumradius, extensionReach, pulseMargin, vertexGap } =
    CIRCUIT_GEOMETRY;
  const vertices = [
    CIRCUIT_VERTICES.apex,
    CIRCUIT_VERTICES.baseLeft,
    CIRCUIT_VERTICES.baseRight,
  ];
  for (const vertex of vertices) {
    assertAlmostEquals(distance(centroid, vertex), circumradius, 0.01);
  }
  const sideLength = distance(
    CIRCUIT_VERTICES.baseLeft,
    CIRCUIT_VERTICES.baseRight,
  );
  assertAlmostEquals(
    distance(CIRCUIT_VERTICES.baseRight, CIRCUIT_VERTICES.apex),
    sideLength,
    0.01,
  );
  assertAlmostEquals(
    distance(CIRCUIT_VERTICES.apex, CIRCUIT_VERTICES.baseLeft),
    sideLength,
    0.01,
  );

  assertEquals(CIRCUIT_EDGES.map(({ id }) => id), ["base", "right", "left"]);
  for (const [index, edge] of CIRCUIT_EDGES.entries()) {
    const next = CIRCUIT_EDGES[(index + 1) % CIRCUIT_EDGES.length];
    assert(next !== undefined);
    assertEquals(edge.toVertex, next.fromVertex, `${edge.id} must hand over`);

    assertAlmostEquals(
      distance(edge.fromVertex, edge.drawn.from),
      vertexGap,
      0.01,
    );
    assertAlmostEquals(distance(edge.drawn.to, edge.toVertex), vertexGap, 0.01);
    assertAlmostEquals(
      cross(edge.fromVertex, edge.toVertex, edge.drawn.from),
      0,
      0.01,
      `${edge.id} drawn run must stay on its side`,
    );

    assertEquals(edge.extensions.length, 2);
    for (const [end, extension] of edge.extensions.entries()) {
      const vertex = end === 0 ? edge.fromVertex : edge.toVertex;
      assertAlmostEquals(distance(vertex, extension.from), vertexGap, 0.01);
      assertAlmostEquals(distance(vertex, extension.to), extensionReach, 0.01);
      assertAlmostEquals(
        cross(edge.fromVertex, edge.toVertex, extension.to),
        0,
        0.01,
        `${edge.id} extension ${end} must continue its side`,
      );
    }
  }

  assertEquals(CIRCUIT_LEGS.map(({ id }) => id), ["base", "right", "left"]);
  for (const [index, leg] of CIRCUIT_LEGS.entries()) {
    const edge = CIRCUIT_EDGES[index];
    assert(edge !== undefined);
    assertAlmostEquals(distance(edge.fromVertex, leg.from), pulseMargin, 0.01);
    assertAlmostEquals(distance(leg.to, edge.toVertex), pulseMargin, 0.01);
    assertMatch(leg.path, /^M [\d.-]+ [\d.-]+ L [\d.-]+ [\d.-]+$/);
  }
});

Deno.test("the gallery stages the circuit plate twice with all stations", () => {
  const dom = new JSDOM(renderArtGallery());
  const artworks = dom.window.document.querySelectorAll<HTMLElement>(
    ".fig-circuit",
  );
  assertEquals(artworks.length, 2);

  for (const artwork of artworks) {
    const svg = artwork.querySelector<SVGElement>('svg[role="img"]');
    assert(svg !== null);
    assertStringIncludes(svg.getAttribute("class") ?? "", "fig-circuit__art");
    assertEquals(svg.querySelectorAll("text").length, 0);

    const labelledBy = (svg.getAttribute("aria-labelledby") ?? "")
      .split(/\s+/).filter(Boolean);
    assertEquals(labelledBy.length, 2);
    for (const id of labelledBy) {
      assert(svg.querySelector(`#${id}`), `${id} must stay local to its SVG`);
    }

    assertEquals(svg.querySelectorAll("[data-circuit-edge]").length, 3);
    assertEquals(svg.querySelectorAll("[data-circuit-extension]").length, 6);
    assertEquals(svg.querySelectorAll(".fig-circuit__circumference").length, 1);
    assertEquals(svg.querySelectorAll(".fig-circuit__tick").length, 2);
    for (const station of ["disc", "ring", "apex"]) {
      assertEquals(
        svg.querySelectorAll(`[data-circuit-station="${station}"]`).length,
        1,
      );
    }
    const apex = svg.querySelector('[data-circuit-station="apex"]');
    assert(apex !== null);
    for (const half of ["echo", "outline", "fill"]) {
      assertEquals(
        apex.querySelectorAll(`.fig-circuit__apex-${half}`).length,
        1,
      );
    }

    const legs = [...svg.querySelectorAll<SVGElement>("[data-circuit-leg]")];
    assertEquals(
      legs.map((leg) => leg.getAttribute("data-circuit-leg")),
      CIRCUIT_LEGS.map(({ id }) => id),
    );
    for (const [index, leg] of legs.entries()) {
      const source = CIRCUIT_LEGS[index];
      assert(source !== undefined);
      const style = leg.getAttribute("style") ?? "";
      assertStringIncludes(style, "--fig-circuit-leg-path");
      assertStringIncludes(style, source.path);
    }
    assertEquals(
      legs.map((leg) => leg.querySelectorAll(".fig-circuit__dash").length),
      [1, 2, 1],
    );
    assertEquals(svg.querySelectorAll(".fig-circuit__dash--accent").length, 1);
    const edge = svg.querySelector("[data-circuit-edge]");
    assert(edge !== null);
    assertEquals(edge.getAttribute("vector-effect"), "non-scaling-stroke");
  }

  dom.window.close();
});

Deno.test("circuit motion closes every loop and keeps the plate monochrome", async () => {
  const css = await Deno.readTextFile(ARTWORK_CSS);

  const keyframes = parsedKeyframes(css);
  assert(keyframes.size >= 6, "the phrase must stage its documented beats");
  for (const [name, frames] of keyframes) {
    assertMatch(name, /^fig-circuit-/);
    const opening = frames.get("0%");
    const closing = frames.get("100%");
    assert(opening !== undefined, `${name} must state its 0% frame`);
    assert(closing !== undefined, `${name} must state its 100% frame`);
    assertEquals(opening, closing, `${name} must return to its rest state`);
  }
  for (const leg of ["base", "right", "left"]) {
    assert(
      keyframes.has(`fig-circuit-pulse-${leg}`),
      `${leg} leg must animate`,
    );
  }

  for (
    const raw of [/#[0-9a-fA-F]{3,8}\b/, /\brgba?\(/, /\bhsla?\(/, /\boklch\(/]
  ) {
    assert(
      !raw.test(css),
      `stylesheet must not declare raw color ${raw.source}`,
    );
  }
  assertEquals(
    css.split("var(--fig-accent)").length - 1,
    1,
    "the accent must fire exactly once",
  );
  assertStringIncludes(css, "offset-path: var(--fig-circuit-leg-path)");
  assertMatch(
    css,
    /\.fig-circuit__pulse\s*\{[^}]*opacity:\s*0/,
    "the pulse must rest invisible",
  );
});
