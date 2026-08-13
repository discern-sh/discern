/** Structural guards for the interference figure's dual-lattice moiré field. */

import { assert, assertEquals, assertStringIncludes } from "@std/assert";
// @ts-types="@types/jsdom"
import { JSDOM } from "jsdom";
import {
  INTERFERENCE_EXTENSIONS,
  INTERFERENCE_FRAME_POINTS,
  INTERFERENCE_GEOMETRY,
  INTERFERENCE_LATTICE,
  INTERFERENCE_VERTICES,
  type InterferencePoint,
} from "../art/browser/interference.tsx";
import { renderArtGallery } from "../site/page-src/art-gallery.tsx";

const ARTWORK_CSS = new URL("../art/browser/interference.css", import.meta.url);

/** Round like the artwork's coordinate serializer. */
function rounded(value: number): number {
  return Math.round(value * 100) / 100;
}

/** A point's perpendicular offset from the centroid for one family. */
function normalOffset(angle: number, point: InterferencePoint): number {
  const { centroid } = INTERFERENCE_GEOMETRY;
  const radians = (angle * Math.PI) / 180;
  const normal = { x: -Math.sin(radians), y: Math.cos(radians) };
  return (point.x - centroid.x) * normal.x + (point.y - centroid.y) * normal.y;
}

/** Every @keyframes rule in the stylesheet, bodies brace-matched. */
function keyframesBlocks(css: string): { name: string; body: string }[] {
  const blocks: { name: string; body: string }[] = [];
  const opening = /@keyframes\s+([\w-]+)\s*\{/g;
  let match = opening.exec(css);
  while (match !== null) {
    let depth = 1;
    let index = opening.lastIndex;
    while (index < css.length && depth > 0) {
      if (css[index] === "{") depth += 1;
      if (css[index] === "}") depth -= 1;
      index += 1;
    }
    blocks.push({
      name: match[1] ?? "",
      body: css.slice(opening.lastIndex, index - 1),
    });
    match = opening.exec(css);
  }
  return blocks;
}

Deno.test("the lattice authority keeps the field true and within budget", () => {
  const { centroid, circumradius, driftLimit, familyAngles, lineBudget } =
    INTERFERENCE_GEOMETRY;
  assertEquals([...familyAngles], [0, 60, 120]);

  const { apex, baseLeft, baseRight } = INTERFERENCE_VERTICES;
  for (const vertex of [apex, baseLeft, baseRight]) {
    const reach = Math.hypot(vertex.x - centroid.x, vertex.y - centroid.y);
    assert(Math.abs(reach - circumradius) < 1e-9, "the frame is equilateral");
  }
  assert(apex.y < baseLeft.y, "the frame points apex up");
  assertEquals(baseLeft.y, baseRight.y);
  assertEquals(rounded(baseLeft.x + baseRight.x), 2 * centroid.x);

  const families = new Map<number, InterferencePoint[]>();
  for (const line of INTERFERENCE_LATTICE) {
    const halfLength = Math.hypot(
      line.to.x - line.from.x,
      line.to.y - line.from.y,
    ) / 2;
    assert(halfLength > circumradius, "every line overfills the frame");
    families.set(line.angle, [...families.get(line.angle) ?? [], line.from]);
  }
  assertEquals([...families.keys()], [...familyAngles]);
  for (const [angle, starts] of families) {
    assert(
      starts.length >= 20 && starts.length <= 28,
      `family ${angle} holds ${starts.length} lines`,
    );
    const offsets = starts.map((start) => normalOffset(angle, start));
    const supports = [apex, baseLeft, baseRight].map((vertex) =>
      normalOffset(angle, vertex)
    );
    assert(
      Math.min(...offsets) < Math.min(...supports) &&
        Math.max(...offsets) > Math.max(...supports),
      `family ${angle} must cross the whole frame with margin to drift`,
    );
  }
  assert(
    INTERFERENCE_LATTICE.length * 2 <= lineBudget,
    "both grids together must respect the line budget",
  );

  assertEquals(driftLimit, 3);
  const { a, b } = INTERFERENCE_GEOMETRY.drift;
  for (const peak of [a.rotate, b.rotate]) {
    assert(
      Math.abs(peak) < driftLimit,
      "drift must stay interference, never become rotation",
    );
  }
  assert(
    INTERFERENCE_GEOMETRY.counterRotation + b.rotate - a.rotate >= 0,
    "the lattices may approach coincidence but never cross it",
  );

  assertEquals(INTERFERENCE_EXTENSIONS.length, 6);
  for (const { from, to } of INTERFERENCE_EXTENSIONS) {
    for (const point of [from, to]) {
      assert(point.x > 0 && point.x < 760 && point.y > 0 && point.y < 540);
    }
  }
});

Deno.test("the gallery renders the interference plate twice with its bounded field", () => {
  const dom = new JSDOM(renderArtGallery());
  const figures = [
    ...dom.window.document.querySelectorAll<HTMLElement>(".fig-interference"),
  ];
  assertEquals(figures.length, 2);

  const clipIds = new Set<string>();
  for (const figure of figures) {
    const svg = figure.querySelector<SVGElement>(
      'svg.fig-interference__art[role="img"]',
    );
    assert(svg !== null);

    const labelled = (svg.getAttribute("aria-labelledby") ?? "").split(/\s+/);
    const prefix = (labelled[0] ?? "").replace(/-title$/, "");
    assert(prefix.length > 0);
    const clip = svg.querySelector(`[id="${prefix}-field"]`);
    assert(clip !== null, "the field clip id must derive from the id prefix");
    clipIds.add(`${prefix}-field`);
    assertEquals(
      clip.firstElementChild?.getAttribute("points"),
      INTERFERENCE_FRAME_POINTS,
      "the clip must be exactly the frame triangle",
    );

    const field = svg.querySelector("[data-interference-field]");
    assert(field !== null);
    assertEquals(field.getAttribute("clip-path"), `url(#${prefix}-field)`);

    const grids = [...svg.querySelectorAll("[data-interference-grid]")];
    assertEquals(
      grids.map((grid) => grid.getAttribute("data-interference-grid")),
      ["a", "b"],
    );
    for (const grid of grids) {
      assertEquals(
        grid.parentElement,
        field,
        "both grids must live inside the one clipped field",
      );
      assertEquals(
        grid.getAttribute("clip-path"),
        null,
        "a clip named on a moving grid would travel with its transform",
      );
      const lines = [...grid.querySelectorAll(".fig-interference__line")];
      assertEquals(lines.length, INTERFERENCE_LATTICE.length);
      for (const line of lines) {
        assertEquals(line.getAttribute("vector-effect"), "non-scaling-stroke");
      }
      assertEquals(
        new Set(
          lines.map((line) => line.getAttribute("data-interference-family")),
        ),
        new Set(["0", "60", "120"]),
      );
    }
    const gridA = grids[0];
    const gridB = grids[1];
    assert(gridA !== undefined && gridB !== undefined);
    assertEquals(gridA.getAttribute("transform"), null);
    assertEquals(
      gridB.getAttribute("transform"),
      `rotate(${INTERFERENCE_GEOMETRY.counterRotation} ` +
        `${INTERFERENCE_GEOMETRY.centroid.x} ` +
        `${INTERFERENCE_GEOMETRY.centroid.y})`,
      "the authored still must already carry the counter-rotation",
    );

    assert(
      svg.querySelectorAll(".fig-interference__line").length <=
        INTERFERENCE_GEOMETRY.lineBudget,
    );
    assertEquals(
      svg.querySelector(".fig-interference__frame")?.getAttribute("points"),
      INTERFERENCE_FRAME_POINTS,
    );
    assertEquals(
      svg.querySelectorAll(".fig-interference__construction line").length,
      INTERFERENCE_EXTENSIONS.length + 2,
    );
  }
  assertEquals(clipIds.size, 2, "each plate must own its clip identifier");
  dom.window.close();
});

Deno.test("the stylesheet stays monochrome and drifts both grids about one pivot", async () => {
  const css = await Deno.readTextFile(ARTWORK_CSS);
  const { centroid, counterRotation, drift, driftLimit } =
    INTERFERENCE_GEOMETRY;

  assert(
    !css.includes("--fig-accent"),
    "the interference is the one accentless figure: its event is alignment",
  );
  assertStringIncludes(
    css,
    `transform-origin: ${centroid.x}px ${centroid.y}px`,
    "both grids must pivot about the frame's centroid",
  );
  assertStringIncludes(css, `rotate(${counterRotation}deg)`);
  assertStringIncludes(
    css,
    `translate(${drift.a.dx}px, ${drift.a.dy}px) rotate(${drift.a.rotate}deg)`,
    "grid A must peak at the authority's drift",
  );
  assertStringIncludes(
    css,
    `translate(${drift.b.dx}px, ${drift.b.dy}px) ` +
      `rotate(${rounded(counterRotation + drift.b.rotate)}deg)`,
    "grid B must peak at the authority's drift from its counter-rotation",
  );

  const blocks = keyframesBlocks(css);
  const rests: Record<string, number> = {
    "fig-interference-grid-a": 0,
    "fig-interference-grid-b": counterRotation,
  };
  assertEquals(blocks.map((block) => block.name), Object.keys(rests));
  for (const block of blocks) {
    const rest = rests[block.name] ?? 0;
    const rotations = [...block.body.matchAll(/rotate\((-?[\d.]+)deg\)/g)]
      .map((found) => Number(found[1]));
    assert(rotations.length > 0);
    for (const rotation of rotations) {
      assert(
        Math.abs(rotation - rest) < driftLimit,
        `${block.name} must drift under ${driftLimit}deg, saw ${rotation}deg`,
      );
    }
  }
});
