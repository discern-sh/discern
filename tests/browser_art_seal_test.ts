/** Structural guards for the seal artwork's fragment-registration contract. */

import { assert, assertEquals, assertStringIncludes } from "@std/assert";
// @ts-types="@types/jsdom"
import { JSDOM } from "jsdom";
import {
  SEAL_CORNER_TICKS,
  SEAL_FRAGMENTS,
  SEAL_SCATTER_LIMITS,
  SEAL_TRIANGLE,
} from "../art/browser/seal.tsx";
import { renderArtGallery } from "../site/page-src/art-gallery.tsx";

const ARTWORK_CSS = new URL("../art/browser/seal.css", import.meta.url);

interface KeyframesBlock {
  readonly name: string;
  readonly body: string;
}

/** Extract every @keyframes block from the stylesheet text. */
function keyframesBlocks(css: string): readonly KeyframesBlock[] {
  const blocks: KeyframesBlock[] = [];
  const opening = /@keyframes\s+([\w-]+)\s*\{/g;
  let match = opening.exec(css);
  while (match !== null) {
    const name = match[1];
    assert(name !== undefined);
    let depth = 1;
    let index = opening.lastIndex;
    while (index < css.length && depth > 0) {
      const character = css[index];
      if (character === "{") depth += 1;
      if (character === "}") depth -= 1;
      index += 1;
    }
    blocks.push({ name, body: css.slice(opening.lastIndex, index - 1) });
    match = opening.exec(css);
  }
  return blocks;
}

/** Collect one key's animated declarations, ignoring segment easing. */
function stateAt(body: string, key: "0%" | "100%"): string {
  const declarations: string[] = [];
  const rules = /([^{}]+)\{([^{}]*)\}/g;
  let rule = rules.exec(body);
  while (rule !== null) {
    const selectors = (rule[1] ?? "").split(",").map((entry) => entry.trim());
    if (selectors.includes(key)) {
      for (const declaration of (rule[2] ?? "").split(";")) {
        const text = declaration.replace(/\s+/g, " ").trim();
        if (text !== "" && !text.startsWith("animation-timing-function")) {
          declarations.push(text);
        }
      }
    }
    rule = rules.exec(body);
  }
  return declarations.sort().join("; ");
}

Deno.test("seal fragments tile one exact triangle inside the scatter envelope", () => {
  assert(SEAL_FRAGMENTS.length >= 12 && SEAL_FRAGMENTS.length <= 16);
  assertEquals(
    new Set(SEAL_FRAGMENTS.map(({ id }) => id)).size,
    SEAL_FRAGMENTS.length,
  );

  const { apex, baseLeft, baseMid, baseRight } = SEAL_TRIANGLE;
  const first = SEAL_FRAGMENTS[0];
  const last = SEAL_FRAGMENTS[SEAL_FRAGMENTS.length - 1];
  assert(first !== undefined && last !== undefined);
  assertEquals(first.from, apex);
  assertEquals(last.to, apex);
  for (let index = 1; index < SEAL_FRAGMENTS.length; index += 1) {
    const previous = SEAL_FRAGMENTS[index - 1];
    const current = SEAL_FRAGMENTS[index];
    assert(previous !== undefined && current !== undefined);
    assertEquals(
      previous.to,
      current.from,
      `${current.id} must continue the outline where ${previous.id} ends`,
    );
  }

  const joints = SEAL_FRAGMENTS.map(({ from }) => `${from.x},${from.y}`);
  for (const anchor of [baseLeft, baseMid, baseRight]) {
    assert(
      joints.includes(`${anchor.x},${anchor.y}`),
      `a fragment joint must land exactly on ${anchor.x},${anchor.y}`,
    );
  }

  for (const { id, scatter } of SEAL_FRAGMENTS) {
    assert(
      Math.hypot(scatter.dx, scatter.dy) <= SEAL_SCATTER_LIMITS.translation,
      `${id} scatters beyond the translation envelope`,
    );
    assert(
      Math.abs(scatter.rotation) <= SEAL_SCATTER_LIMITS.rotation,
      `${id} rotates beyond the envelope`,
    );
    assert(scatter.dx !== 0 || scatter.dy !== 0, `${id} must displace`);
  }

  const traitors = SEAL_FRAGMENTS.filter(({ group }) => group === "traitor");
  assertEquals(traitors.length, 1, "exactly one fragment departs first");
  const traitor = traitors[0];
  assert(traitor !== undefined);
  for (const end of [traitor.from, traitor.to]) {
    for (const corner of [apex, baseLeft, baseRight]) {
      assert(
        corner.x !== end.x || corner.y !== end.y,
        "the departing fragment must sit mid-edge, away from every vertex",
      );
    }
  }

  assertEquals(SEAL_CORNER_TICKS.length, 6);
});

Deno.test("the gallery renders the sealed composition twice with derived clips", () => {
  const dom = new JSDOM(renderArtGallery());
  const figures = [
    ...dom.window.document.querySelectorAll<HTMLElement>(".fig-seal"),
  ];
  assertEquals(figures.length, 2);

  const clipIds = new Set<string>();
  for (const figure of figures) {
    const svg = figure.querySelector<SVGElement>(
      'svg.fig-seal__art[role="img"]',
    );
    assert(svg !== null);
    assertEquals(svg.querySelectorAll("text").length, 0);

    const fragments = [...svg.querySelectorAll(".fig-seal__fragment")];
    assertEquals(fragments.length, SEAL_FRAGMENTS.length);
    for (const fragment of fragments) {
      assertStringIncludes(
        fragment.getAttribute("style") ?? "",
        "--fig-seal-scatter",
      );
      assertEquals(
        fragment.getAttribute("vector-effect"),
        "non-scaling-stroke",
      );
    }
    assertEquals(
      svg.querySelectorAll(".fig-seal__fragment--traitor").length,
      1,
    );
    assertEquals(svg.querySelectorAll(".fig-seal__sweep-line").length, 1);

    const labelled = (svg.getAttribute("aria-labelledby") ?? "").split(/\s+/);
    const prefix = (labelled[0] ?? "").replace(/-title$/, "");
    assert(prefix.length > 0);
    assert(svg.querySelector(`[id="${prefix}-flood"]`) !== null);
    assert(svg.querySelector(`[id="${prefix}-frame"]`) !== null);
    clipIds.add(`${prefix}-flood`);

    const ink = svg.querySelector(".fig-seal__ink");
    assert(ink !== null);
    assertEquals(
      ink.getAttribute("clip-path"),
      null,
      "a clip named on the moving ink would travel with its transform",
    );
    assertEquals(
      ink.parentElement?.getAttribute("clip-path"),
      `url(#${prefix}-flood)`,
      "the flood clip must sit on a static wrapper around the ink",
    );
  }
  assertEquals(clipIds.size, 2, "each frame must own its clip identifiers");
  dom.window.close();
});

Deno.test("the seal stylesheet closes every keyframe loop at the sealed rest", async () => {
  const css = await Deno.readTextFile(ARTWORK_CSS);

  for (
    const pattern of [
      /#[0-9a-f]{3,8}\b/i,
      /\brgba?\(/,
      /\bhsla?\(/,
      /\boklch\(/,
    ]
  ) {
    assert(!pattern.test(css), `raw color forbidden: ${pattern.source}`);
  }

  const blocks = keyframesBlocks(css);
  assert(blocks.length > 0);
  for (const block of blocks) {
    assert(
      block.name.startsWith("fig-seal-"),
      `${block.name} must stay namespaced`,
    );
    const openingState = stateAt(block.body, "0%");
    const closingState = stateAt(block.body, "100%");
    assert(openingState.length > 0, `${block.name} must declare its 0% state`);
    assertEquals(
      openingState,
      closingState,
      `${block.name} must return to its opening frame`,
    );
  }

  for (const family of new Set(SEAL_FRAGMENTS.map(({ group }) => group))) {
    assert(
      blocks.some(({ name }) => name === `fig-seal-loosen-${family}`),
      `the ${family} staging family needs its keyframes`,
    );
  }

  const sweepStart = css.indexOf(".fig-seal__sweep-line");
  assert(sweepStart >= 0, "the sweep line must keep its styling rule");
  const sweepRule = css.slice(sweepStart, css.indexOf("}", sweepStart));
  assertStringIncludes(
    sweepRule,
    "var(--fig-accent)",
    "the confirming sweep carries the piece's one accent",
  );
  assertEquals(
    css.split("var(--fig-accent)").length,
    2,
    "the accent token must appear exactly once in the stylesheet",
  );
});
