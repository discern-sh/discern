/** Structural guards for the ratchet figure's converging-limit composition. */

import { assert, assertEquals, assertStringIncludes } from "@std/assert";
// @ts-types="@types/jsdom"
import { JSDOM } from "jsdom";
import {
  RATCHET_APEX,
  RATCHET_LIMIT_DASH,
  RATCHET_LOWER_STEPS,
  RATCHET_MARK,
  RATCHET_MEASURE_POINTS,
  RATCHET_NOTCHES,
  RATCHET_PLATE_LEFT,
  RATCHET_UPPER_STEPS,
  type RatchetStep,
} from "../art/browser/ratchet.tsx";
import { renderArtGallery } from "../site/page-src/art-gallery.tsx";

const ARTWORK_CSS = new URL("../art/browser/ratchet.css", import.meta.url);
const ARTWORK_TSX = new URL("../art/browser/ratchet.tsx", import.meta.url);

/** The level a limit line holds at a horizontal position. */
function limitAt(steps: readonly RatchetStep[], x: number): number {
  const first = steps[0];
  assert(first !== undefined);
  let level = first.from;
  for (const step of steps) if (x >= step.x) level = step.to;
  return level;
}

/** A staircase's exact drawn length: its runs plus its vertical steps. */
function staircaseLength(steps: readonly RatchetStep[]): number {
  let length = RATCHET_APEX.x - RATCHET_PLATE_LEFT;
  for (const step of steps) length += Math.abs(step.to - step.from);
  return length;
}

/** Every @keyframes block in the stylesheet, bodies brace-matched. */
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

/** Normalized declarations, ignoring segment timing which has no end state. */
function boundaryState(declarations: string): readonly string[] {
  return declarations
    .split(";")
    .map((declaration) => declaration.replace(/\s+/g, " ").trim())
    .filter((declaration) =>
      declaration !== "" && !declaration.startsWith("animation-timing-function")
    )
    .sort();
}

Deno.test("the ratchet's corridor converges monotonically to the apex", () => {
  assertEquals(RATCHET_UPPER_STEPS.length, 5);
  assertEquals(RATCHET_LOWER_STEPS.length, 4);
  const stepXs = [...RATCHET_UPPER_STEPS, ...RATCHET_LOWER_STEPS]
    .map((step) => step.x);
  assertEquals(new Set(stepXs).size, stepXs.length, "steps never coincide");

  const lines = [
    [RATCHET_UPPER_STEPS, 1],
    [RATCHET_LOWER_STEPS, -1],
  ] as const;
  for (const [steps, inward] of lines) {
    let previousMagnitude = Number.POSITIVE_INFINITY;
    for (const [index, step] of steps.entries()) {
      assert((step.to - step.from) * inward > 0, "every step moves inward");
      const magnitude = Math.abs(step.to - step.from);
      assert(magnitude <= previousMagnitude, "steps diminish toward the apex");
      previousMagnitude = magnitude;
      const next = steps[index + 1];
      if (next !== undefined) {
        assert(step.x < next.x, "steps advance across the plate");
        assertEquals(next.from, step.to, "runs continue where the step landed");
      }
    }
    const last = steps[steps.length - 1];
    assert(last !== undefined);
    assertEquals(last.to, RATCHET_APEX.y, "each limit ends on the apex level");
    assertEquals(staircaseLength(steps), RATCHET_LIMIT_DASH);
  }
  const closing = RATCHET_LOWER_STEPS[RATCHET_LOWER_STEPS.length - 1];
  assert(closing !== undefined);
  assertEquals(closing.x, RATCHET_APEX.x, "the last step lands at the apex");

  const points = RATCHET_MEASURE_POINTS;
  assert(points.length >= 30 && points.length <= 45);
  const first = points[0];
  const final = points[points.length - 1];
  assert(first !== undefined && final !== undefined);
  assertEquals(first[0], RATCHET_PLATE_LEFT);
  assertEquals([final[0], final[1]], [RATCHET_APEX.x, RATCHET_APEX.y]);
  let previousX = Number.NEGATIVE_INFINITY;
  for (const [x, y] of points) {
    assert(x > previousX, "the measure must always advance");
    previousX = x;
    assert(y >= limitAt(RATCHET_UPPER_STEPS, x), `(${x}, ${y}) above limit`);
    assert(y <= limitAt(RATCHET_LOWER_STEPS, x), `(${x}, ${y}) below limit`);
  }
  const deviation = (slice: typeof points): number =>
    Math.max(...slice.map(([, y]) => Math.abs(y - RATCHET_APEX.y)));
  const quarter = Math.floor(points.length / 4);
  assert(
    deviation(points.slice(-quarter)) < deviation(points.slice(0, quarter)),
    "the oscillation must narrow with the corridor",
  );

  assertEquals(RATCHET_NOTCHES.length, stepXs.length);
  assertEquals(
    RATCHET_NOTCHES.map((notch) => notch.index),
    RATCHET_NOTCHES.map((_, position) => position + 1),
  );
  assertEquals(
    RATCHET_NOTCHES.filter((notch) => notch.outward === -1).length,
    RATCHET_UPPER_STEPS.length,
  );
  assert(RATCHET_MARK.leftX > RATCHET_APEX.x, "the mark sits past the apex");
  assertEquals(
    RATCHET_MARK.splitX - RATCHET_MARK.leftX,
    RATCHET_MARK.rightX - RATCHET_MARK.splitX,
    "the split must divide the mark symmetrically",
  );
});

Deno.test("the gallery renders the ratchet plate twice with its apparatus", () => {
  const dom = new JSDOM(renderArtGallery());
  const figures = [...dom.window.document.querySelectorAll(".fig-ratchet")];
  assertEquals(figures.length, 2);
  for (const figure of figures) {
    const svg = figure.querySelector('svg.fig-ratchet__art[role="img"]');
    assert(svg !== null);
    assertEquals(svg.querySelectorAll("[data-ratchet-measure]").length, 1);
    assertEquals(
      [...svg.querySelectorAll("[data-ratchet-limit]")]
        .map((limit) => limit.getAttribute("data-ratchet-limit")),
      ["upper", "lower"],
    );
    const notches = [...svg.querySelectorAll(".fig-ratchet__notch")];
    assertEquals(notches.length, RATCHET_NOTCHES.length);
    for (const [position, notch] of notches.entries()) {
      assert(notch.classList.contains(`fig-ratchet__notch--n${position + 1}`));
    }
    assertEquals(
      svg.querySelectorAll(".fig-ratchet__rule").length,
      RATCHET_NOTCHES.length,
    );
    const mark = svg.querySelector("[data-ratchet-mark]");
    assert(mark !== null);
    for (const half of ["outline", "fill", "accent"]) {
      const selector = `.fig-ratchet__mark-${half}`;
      assertEquals(mark.querySelectorAll(selector).length, 1);
    }
    assertEquals(svg.querySelectorAll("text").length, 0);
    const smil = "animate, animateTransform, animateMotion, set";
    assertEquals(svg.querySelectorAll(smil).length, 0);
    const labelledBy = (svg.getAttribute("aria-labelledby") ?? "")
      .split(/\s+/).filter(Boolean);
    assertEquals(labelledBy.length, 2);
    for (const id of labelledBy) {
      assert(svg.querySelector(`#${id}`) !== null, `${id} must stay local`);
    }
  }
  dom.window.close();
});

Deno.test("every ratchet phrase closes its loop and keeps the shared palette", async () => {
  const css = await Deno.readTextFile(ARTWORK_CSS);
  const tsx = await Deno.readTextFile(ARTWORK_TSX);
  const raw = [/#[0-9a-fA-F]{3,8}\b/, /\brgba?\(/, /\bhsla?\(/, /\boklch\(/];
  for (const source of [css, tsx]) {
    for (const pattern of raw) {
      assert(!pattern.test(source), `raw color ${pattern.source} is forbidden`);
    }
  }
  assertEquals(css.split("var(--fig-accent)").length, 2, "one accent only");
  assertStringIncludes(css, `stroke-dasharray: ${RATCHET_LIMIT_DASH}`);

  const blocks = keyframesBlocks(css);
  assert(blocks.length >= 14, "the full choreography must be present");
  for (const block of blocks) {
    assert(block.name.startsWith("fig-ratchet-"), `${block.name} namespace`);
    const rules = [...block.body.matchAll(/([^{}]+)\{([^{}]*)\}/g)].map(
      (rule) => ({
        selectors: (rule[1] ?? "").split(",").map((part) => part.trim()),
        declarations: rule[2] ?? "",
      }),
    );
    const atRest = rules.find((rule) => rule.selectors.includes("0%"));
    const atClose = rules.find((rule) => rule.selectors.includes("100%"));
    assert(atRest !== undefined, `${block.name} must pin its 0% state`);
    assert(atClose !== undefined, `${block.name} must pin its 100% state`);
    assertEquals(
      boundaryState(atRest.declarations),
      boundaryState(atClose.declarations),
      `${block.name} must end exactly where it began`,
    );
  }
});
