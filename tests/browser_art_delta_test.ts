/** Structural guards for the delta figure's channels, gates, and loop. */

import { assert, assertEquals, assertStringIncludes } from "@std/assert";
// @ts-types="@types/jsdom"
import { JSDOM } from "jsdom";
import {
  DELTA_CHANNEL_COUNT,
  DELTA_CHANNELS,
  DELTA_EXIT_GUIDE,
  DELTA_FORK,
  DELTA_GATE_TICK_COUNT,
  DELTA_MERGE,
} from "../art/browser/delta.tsx";
import { renderArtGallery } from "../site/page-src/art-gallery.tsx";

const ARTWORK_CSS = new URL("../art/browser/delta.css", import.meta.url);

/** Pull every number out of a path-data string, in order. */
function numbersIn(d: string): readonly number[] {
  return (d.match(/-?\d+(?:\.\d+)?/g) ?? []).map(Number);
}

/** Extract every @keyframes body from a stylesheet by brace matching. */
function keyframesBlocks(css: string): ReadonlyMap<string, string> {
  const blocks = new Map<string, string>();
  const heads = css.matchAll(/@keyframes\s+([\w-]+)\s*\{/g);
  for (const head of heads) {
    const name = head[1];
    assert(name !== undefined);
    let depth = 1;
    const start = head.index + head[0].length;
    let end = start;
    while (depth > 0 && end < css.length) {
      const character = css[end];
      if (character === "{") depth += 1;
      if (character === "}") depth -= 1;
      end += 1;
    }
    assertEquals(depth, 0, `@keyframes ${name} must close its braces`);
    blocks.set(name, css.slice(start, end - 1));
  }
  return blocks;
}

/**
 * Map each percentage selector inside one keyframes body to its normalized
 * visual declarations. Timing functions govern the segment that follows a
 * keyframe, not the state at it, so they are excluded from the comparison.
 */
function keyframeStates(body: string): ReadonlyMap<string, string> {
  const states = new Map<string, string>();
  for (const rule of body.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    const selectors = (rule[1] ?? "").split(",").map((s) => s.trim());
    const declarations = (rule[2] ?? "")
      .split(";")
      .map((declaration) => declaration.trim())
      .filter((declaration) =>
        declaration !== "" &&
        !declaration.startsWith("animation-timing-function")
      )
      .sort()
      .join("; ");
    for (const selector of selectors) {
      assert(selector !== "", "keyframe selectors must be named");
      assert(
        !states.has(selector),
        `${selector} must appear once per keyframes block`,
      );
      states.set(selector, declarations);
    }
  }
  return states;
}

Deno.test("the delta renders twice with its channels, gates, and travellers", () => {
  const dom = new JSDOM(renderArtGallery());
  const figures = [
    ...dom.window.document.querySelectorAll<HTMLElement>("figure.fig-delta"),
  ];
  assertEquals(figures.length, 2);

  for (const figure of figures) {
    const svg = figure.querySelector<SVGElement>(
      'svg.fig-delta__art[role="img"]',
    );
    assert(svg !== null);
    const labelledBy = (svg.getAttribute("aria-labelledby") ?? "")
      .split(/\s+/).filter(Boolean);
    assertEquals(labelledBy.length, 2);
    for (const id of labelledBy) {
      assert(svg.querySelector(`#${id}`), `${id} must stay local to its SVG`);
    }

    const channels = [...svg.querySelectorAll("[data-delta-channel]")];
    assertEquals(channels.length, DELTA_CHANNEL_COUNT);
    assertEquals(
      channels.map((channel) => channel.getAttribute("data-delta-channel")),
      DELTA_CHANNELS.map(({ id }) => id),
    );
    assertEquals(
      svg.querySelectorAll(".fig-delta__gate").length,
      DELTA_GATE_TICK_COUNT,
    );

    const chevrons = [...svg.querySelectorAll("[data-delta-chevron]")];
    assertEquals(chevrons.length, DELTA_CHANNEL_COUNT);
    for (const [index, chevron] of chevrons.entries()) {
      const channel = DELTA_CHANNELS[index];
      assert(channel !== undefined);
      assertEquals(chevron.getAttribute("data-delta-chevron"), channel.id);
      const style = chevron.getAttribute("style") ?? "";
      assertStringIncludes(style, channel.d);
      assertStringIncludes(style, channel.chevronRest);
    }

    const pulse = svg.querySelector(".fig-delta__pulse");
    assert(pulse !== null);
    assertStringIncludes(pulse.getAttribute("style") ?? "", DELTA_EXIT_GUIDE);

    assertEquals(svg.querySelectorAll(".fig-delta__fork").length, 1);
    assertEquals(svg.querySelectorAll(".fig-delta__merge").length, 1);
    assertEquals(svg.querySelectorAll(".fig-delta__envelope").length, 1);
    assertEquals(svg.querySelectorAll("text").length, 0);
  }

  dom.window.close();
});

Deno.test("the delta stylesheet closes every loop and stays tokenised", async () => {
  const css = await Deno.readTextFile(ARTWORK_CSS);

  const blocks = keyframesBlocks(css);
  assert(blocks.size >= 7, "the phrase choreographs at least seven parts");
  for (const [name, body] of blocks) {
    assert(name.startsWith("fig-delta-"), `${name} must stay namespaced`);
    const states = keyframeStates(body);
    const opening = states.get("0%");
    const closing = states.get("100%");
    assert(opening !== undefined, `${name} must declare its 0% state`);
    assert(closing !== undefined, `${name} must declare its 100% state`);
    assertEquals(
      opening,
      closing,
      `${name} must return to its opening frame`,
    );
  }

  assert(!/#[0-9a-fA-F]{3,8}\b/.test(css), "no raw hex colors");
  assert(!/\b(?:rgb|hsl|oklch)a?\(/.test(css), "no raw functional colors");
  assertEquals(
    css.split("--fig-accent").length - 1,
    1,
    "the accent appears exactly once",
  );
});

Deno.test("the delta geometry shares one fork, one confluence, aligned gates", () => {
  assertEquals(DELTA_CHANNEL_COUNT, 3);
  assertEquals(DELTA_GATE_TICK_COUNT, DELTA_CHANNEL_COUNT);

  const endpoints = DELTA_CHANNELS.map(({ d }) => {
    const numbers = numbersIn(d);
    assert(numbers.length >= 4, "a channel needs at least two points");
    return {
      start: numbers.slice(0, 2).join(" "),
      end: numbers.slice(-2).join(" "),
    };
  });
  assertEquals(new Set(endpoints.map(({ start }) => start)).size, 1);
  assertEquals(new Set(endpoints.map(({ end }) => end)).size, 1);
  assertEquals(
    endpoints[0]?.start,
    `${DELTA_FORK.apexX} ${DELTA_FORK.y}`,
    "channels depart at the fork's apex, never inside its open form",
  );
  assertEquals(
    endpoints[0]?.end,
    `${DELTA_MERGE.baseX} ${DELTA_MERGE.y}`,
    "channels arrive at the confluence's base",
  );

  const first = DELTA_CHANNELS[0];
  assert(first !== undefined);
  const forkX = numbersIn(first.d)[0];
  const mergeX = numbersIn(first.d).at(-2);
  assert(forkX !== undefined && mergeX !== undefined);
  assertEquals(
    new Set(DELTA_CHANNELS.map(({ gate }) => gate.x)).size,
    1,
    "the gates register on one shared vertical",
  );
  for (const { gate } of DELTA_CHANNELS) {
    assert(gate.x > forkX && gate.x < mergeX, "gates sit between the nodes");
    assert(gate.y1 < gate.y2, "each tick spans downward");
  }
  assertEquals(
    new Set(DELTA_CHANNELS.map(({ gate }) => (gate.y1 + gate.y2) / 2)).size,
    DELTA_CHANNEL_COUNT,
    "each channel carries its own gate",
  );

  assertEquals(
    new Set(DELTA_CHANNELS.map(({ chevronRest }) => chevronRest)).size,
    DELTA_CHANNEL_COUNT,
    "resting chevrons stagger along their channels",
  );

  const exitStart = numbersIn(DELTA_EXIT_GUIDE).slice(0, 2).join(" ");
  assertEquals(
    exitStart,
    `${DELTA_MERGE.apexX} ${DELTA_MERGE.y}`,
    "the accent pulse departs from the confluence apex",
  );
});
