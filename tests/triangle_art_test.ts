/** Exact-frame and enrolment contracts for the reusable triangle motifs. */

import { assert, assertEquals, assertThrows } from "@std/assert";
import {
  DISCERN_TRIANGLE_GLYPHS,
  DISCERN_TRIANGLE_MOTIFS,
  DISCERN_TRIANGLE_SPINNER_CYCLE,
  DISCERN_TRIANGLE_WEAVE_CYCLE,
  MAX_TRIANGLE_ART_CELLS,
  renderTriangleBeacon,
  renderTriangleGasket,
  renderTrianglePattern,
  renderTriangleProgress,
  renderTrianglePyramid,
  renderTriangleSectionRule,
  renderTriangleSpinnerFrame,
  renderTriangleStepper,
} from "../src/lib/triangle_art.ts";
import { displayWidth } from "../src/lib/text.ts";

const DIVIDER = "◮⧩◭⧨◮⧩◭⧨◮⧩◭⧨◮⧩◭⧨◮⧩◭⧨◮⧩◭⧨◮⧩◭⧨◮⧩◭⧨";
const RIBBON = [
  "◮⧩◭⧨◮⧩◭⧨◮⧩◭⧨◮⧩◭⧨◮⧩◭⧨◮⧩◭⧨",
  "⧨◮⧩◭⧨◮⧩◭⧨◮⧩◭⧨◮⧩◭⧨◮⧩◭⧨◮⧩◭",
  "◮⧩◭⧨◮⧩◭⧨◮⧩◭⧨◮⧩◭⧨◮⧩◭⧨◮⧩◭⧨",
].join("\n");
const WEAVE = [
  "◮⧩◭⧨",
  "⧨◮⧩◭",
  "◮⧩◭⧨",
  "⧨◮⧩◭",
  "◮⧩◭⧨",
  "⧨◮⧩◭",
  "◮⧩◭⧨",
  "⧨◮⧩◭",
].join("\n");
const EXPECTED_MOTIFS = {
  divider: DIVIDER,
  ribbon: RIBBON,
  weave: WEAVE,
  spinner: "◮ -> ◭ -> ⧨ -> ⧩ -> (repeat)",
  progress: `[25%] ${"◮⧩◭⧨".repeat(2)}◮⧩${".".repeat(30)}`,
  "section-rule": "◮⧩◭⧨◮⧩◭⧨ quality gate ⧨◭⧩◮⧨◭⧩◮",
  stepper: [
    "◮ inspect",
    "│",
    "◭ plan",
    "│",
    "⧨ apply",
    "│",
    "[⧩] verify",
  ].join("\n"),
  beacon: `${".".repeat(14)}◮⧩◭⧨${".".repeat(14)}`,
  pyramid: [
    "       ◮",
    "      ◮⧩◭",
    "     ◮⧩◭⧨◮",
    "    ◮⧩◭⧨◮⧩◭",
    "   ◮⧩◭⧨◮⧩◭⧨◮",
    "  ◮⧩◭⧨◮⧩◭⧨◮⧩◭",
    " ◮⧩◭⧨◮⧩◭⧨◮⧩◭⧨◮",
    "◮⧩◭⧨◮⧩◭⧨◮⧩◭⧨◮⧩◭",
  ].join("\n"),
  gasket: [
    "       ◮",
    "      ◮ ◭",
    "     ◮   ◮",
    "    ◮ ◭ ◮ ◭",
    "   ◮       ◮",
    "  ◮ ◭     ◮ ◭",
    " ◮   ◮   ◮   ◮",
    "◮ ◭ ◮ ◭ ◮ ◭ ◮ ◭",
  ].join("\n"),
} as const;

/** Measure the first motif cell in one ANSI-free animation frame. */
function firstMotifColumn(frame: string, motif: RegExp): number {
  const index = frame.search(motif);
  assert(index >= 0, `frame contains no ${motif}: ${JSON.stringify(frame)}`);
  return displayWidth(frame.slice(0, index));
}

Deno.test("triangle glyph facts derive both intentional cycle orders", () => {
  assertEquals(DISCERN_TRIANGLE_GLYPHS, {
    upRight: "◮",
    upLeft: "◭",
    downLeft: "⧨",
    downRight: "⧩",
  });
  assertEquals([...DISCERN_TRIANGLE_WEAVE_CYCLE], ["◮", "⧩", "◭", "⧨"]);
  assertEquals([...DISCERN_TRIANGLE_SPINNER_CYCLE], ["◮", "◭", "⧨", "⧩"]);
  for (const glyph of Object.values(DISCERN_TRIANGLE_GLYPHS)) {
    assertEquals(displayWidth(glyph), 1, glyph);
  }
});

Deno.test("triangle pattern renders length, thickness, phase, and direction", () => {
  assertEquals(renderTrianglePattern({ columns: 32 }), DIVIDER);
  assertEquals(renderTrianglePattern({ columns: 4, rows: 8 }), WEAVE);
  assertEquals(
    renderTrianglePattern({ columns: 4, rows: 2, oddRowPhase: 0 }),
    "◮⧩◭⧨\n◮⧩◭⧨",
  );
  assertEquals(renderTrianglePattern({ columns: 4, phase: 1 }), "⧩◭⧨◮");
  assertEquals(renderTrianglePattern({ columns: 4, phase: -1 }), "⧨◮⧩◭");
  assertEquals(
    renderTrianglePattern({
      columns: 8,
      phase: Number.MAX_SAFE_INTEGER,
    }),
    "⧨◮⧩◭⧨◮⧩◭",
  );
  assertEquals(
    renderTrianglePattern({ columns: 8, direction: "reverse" }),
    "⧨◭⧩◮⧨◭⧩◮",
  );
});

Deno.test("triangle section rules reflect their left arm at every phase", () => {
  for (const width of [10, 11, 14, 19]) {
    for (const phase of [-1, 0, 1, 3]) {
      const rule = renderTriangleSectionRule("gate", { width, phase });
      assertEquals(displayWidth(rule), width);
      const [left, right] = rule.split(" gate ");
      assert(left !== undefined && right !== undefined);
      const mirroredLeft = [...left].reverse();
      assertEquals(
        [...right].slice(0, mirroredLeft.length),
        mirroredLeft,
        `width ${width}, phase ${phase}`,
      );
      assert(
        right.length === left.length || right.length === left.length + 1,
        `width ${width} has an unexplained arm imbalance`,
      );
    }
  }
});

Deno.test("triangle state renderers expose reusable exact frames", () => {
  assertEquals(
    [0, 1, 2, 3, 4, -1].map(renderTriangleSpinnerFrame),
    ["◮", "◭", "⧨", "⧩", "◮", "⧩"],
  );
  assertEquals(
    renderTriangleProgress({ completed: 0, total: 3, width: 4 }),
    "[0%] ....",
  );
  assertEquals(
    renderTriangleProgress({ completed: 1, total: 3, width: 4 }),
    "[33%] ◮...",
  );
  assertEquals(
    renderTriangleProgress({ completed: 29, total: 100, width: 4 }),
    "[29%] ◮...",
  );
  assertEquals(
    renderTriangleProgress({
      completed: 0.2899999999999999,
      total: 1,
      width: 100,
    }),
    `[28%] ${"◮⧩◭⧨".repeat(7)}${".".repeat(72)}`,
  );
  assertEquals(
    renderTriangleProgress({ completed: 3, total: 3, width: 4 }),
    "[100%] ◮⧩◭⧨",
  );
  const rule = renderTriangleSectionRule("quality gate", { width: 30 });
  assertEquals(rule, EXPECTED_MOTIFS["section-rule"]);
  assertEquals(displayWidth(rule), 30);
  assertEquals(
    renderTriangleStepper(["inspect", "plan", "apply"], {
      activeIndex: 1,
    }),
    "◮ inspect\n│\n[◭] plan\n│\n· apply",
  );
  assertEquals(
    renderTriangleBeacon({ width: 8, offset: 2, phase: 1 }),
    "..⧩◭⧨◮..",
  );
  assertEquals(
    renderTrianglePyramid({ rows: 3 }),
    "  ◮\n ◮⧩◭\n◮⧩◭⧨◮",
  );
  assertEquals(
    renderTrianglePyramid({ rows: 3, phase: 2 }),
    "  ◭\n ◭⧨◮\n◭⧨◮⧩◭",
  );
});

Deno.test("triangle gasket opens the woven pyramid one subdivision at a time", () => {
  assertEquals(
    renderTriangleGasket({ rows: 8, levels: 0 }),
    renderTrianglePyramid({ rows: 8 }),
  );
  assertEquals(
    renderTriangleGasket({ rows: 8, levels: 0, phase: 3 }),
    renderTrianglePyramid({ rows: 8, phase: 3 }),
  );
  assertEquals(
    renderTriangleGasket({ rows: 4, levels: 1 }),
    ["   ◮", "  ◮⧩◭", " ◮   ◮", "◮⧩◭ ◮⧩◭"].join("\n"),
  );
  assertEquals(
    renderTriangleGasket({ rows: 4, levels: 2 }),
    ["   ◮", "  ◮ ◭", " ◮   ◮", "◮ ◭ ◮ ◭"].join("\n"),
  );
  // At full depth only up-pointing cells remain: 3^depth marks, no downs.
  const fullDepth = renderTriangleGasket({ rows: 8 });
  assertEquals(
    [...fullDepth].filter((glyph) => glyph === "◮" || glyph === "◭").length,
    27,
  );
  assert(!fullDepth.includes("⧨"));
  assert(!fullDepth.includes("⧩"));
});

Deno.test("triangle state renderers reject impossible frames", () => {
  const invalidRenders = [
    () => renderTrianglePattern({ columns: 0 }),
    () => renderTrianglePattern({ columns: 4, rows: 1.5 }),
    () => renderTrianglePattern({ columns: 4, phase: Number.NaN }),
    () =>
      renderTrianglePattern({
        columns: 4,
        direction: "sideways" as never,
      }),
    () => renderTriangleSpinnerFrame(0.5),
    () => renderTriangleProgress({ completed: 1, total: 0, width: 4 }),
    () => renderTriangleProgress({ completed: -1, total: 2, width: 4 }),
    () => renderTriangleProgress({ completed: 3, total: 2, width: 4 }),
    () => renderTriangleProgress({ completed: 1, total: 2, width: 0 }),
    () => renderTriangleSectionRule(" gate", { width: 20 }),
    () => renderTriangleSectionRule("gate", { width: 7 }),
    () => renderTriangleStepper([], { activeIndex: 0 }),
    () => renderTriangleStepper(["inspect"], { activeIndex: 1 }),
    () => renderTriangleStepper(["inspect\nplan"], { activeIndex: 0 }),
    () => renderTriangleBeacon({ width: 3, offset: 0 }),
    () => renderTriangleBeacon({ width: 8, offset: 5 }),
    () => renderTrianglePyramid({ rows: 0 }),
    () => renderTrianglePyramid({ rows: 2, phase: 0.5 }),
    () => renderTriangleGasket({ rows: 0 }),
    () => renderTriangleGasket({ rows: 6 }),
    () => renderTriangleGasket({ rows: 8, levels: 4 }),
    () => renderTriangleGasket({ rows: 8, levels: -1 }),
    () => renderTriangleGasket({ rows: 4, phase: 0.5 }),
  ];
  for (const render of invalidRenders) {
    assertThrows(render, TypeError);
  }
});

Deno.test("every triangle renderer holds the total visible-cell budget", () => {
  const overBudgetRenders = {
    "pattern area": () =>
      renderTrianglePattern({
        columns: MAX_TRIANGLE_ART_CELLS,
        rows: 2,
      }),
    "progress label overhead": () =>
      renderTriangleProgress({
        completed: 1,
        total: 2,
        width: MAX_TRIANGLE_ART_CELLS,
      }),
    "section rule": () =>
      renderTriangleSectionRule("gate", {
        width: MAX_TRIANGLE_ART_CELLS + 1,
      }),
    "many-step stepper": () =>
      renderTriangleStepper(
        Array.from({ length: 3_000 }, () => "x"),
        { activeIndex: 2_999 },
      ),
    "long-label stepper": () =>
      renderTriangleStepper(["x".repeat(MAX_TRIANGLE_ART_CELLS)], {
        activeIndex: 0,
      }),
    beacon: () =>
      renderTriangleBeacon({
        width: MAX_TRIANGLE_ART_CELLS + 1,
        offset: 0,
      }),
    "pyramid area": () => renderTrianglePyramid({ rows: 101 }),
    "gasket area": () => renderTriangleGasket({ rows: 128 }),
  } satisfies Readonly<Record<string, () => string>>;
  const unguarded: string[] = [];
  for (const [name, render] of Object.entries(overBudgetRenders)) {
    try {
      render();
      unguarded.push(name);
    } catch (error) {
      assert(error instanceof TypeError, `${name} threw ${String(error)}`);
    }
  }
  assertEquals(unguarded, []);
});

Deno.test("the motif registry preserves every curated static design", () => {
  assertEquals(
    Object.keys(DISCERN_TRIANGLE_MOTIFS),
    Object.keys(EXPECTED_MOTIFS),
  );
  for (const [name, motif] of Object.entries(DISCERN_TRIANGLE_MOTIFS)) {
    assertEquals(motif.charset, "unicode", name);
    assertEquals(
      motif.render(),
      EXPECTED_MOTIFS[name as keyof typeof EXPECTED_MOTIFS],
    );
    assertEquals(motif.render(), motif.render(), name);
  }
});

Deno.test("every triangle motif owns active terminal-safe motion", () => {
  for (const [name, motif] of Object.entries(DISCERN_TRIANGLE_MOTIFS)) {
    const animation = motif.animate();
    assertEquals(animation, motif.animate(), name);
    assert(animation.frames.length > 1, `${name} needs more than one frame`);
    assertEquals(animation.frames.at(-1), motif.render(), name);
    assert(
      animation.frames.some((frame) => frame !== motif.render()),
      `${name} needs visible motion`,
    );
    for (const frame of animation.frames) {
      assert(frame !== "", `${name} has an empty frame`);
      assert(!frame.endsWith("\n"), `${name} owns a final newline`);
      for (const character of frame) {
        assert(
          character === "\n" || !/[\p{Cc}\p{Cf}]/u.test(character),
          `${name} contains terminal control ${JSON.stringify(character)}`,
        );
      }
      for (const line of frame.split("\n")) {
        assert(!/\s$/u.test(line), `${name} has trailing whitespace`);
      }
    }
  }
  assertEquals(
    DISCERN_TRIANGLE_MOTIFS.spinner.animate().frames.slice(0, 8),
    ["◮", "◭", "⧨", "⧩", "◮", "◭", "⧨", "⧩"],
  );
  const progressColumns = DISCERN_TRIANGLE_MOTIFS.progress.animate().frames.map(
    (frame) => firstMotifColumn(frame, /[.◮◭⧨⧩]/u),
  );
  assertEquals(new Set(progressColumns).size, 1);

  const beaconColumns = DISCERN_TRIANGLE_MOTIFS.beacon.animate().frames.map(
    (frame) => firstMotifColumn(frame, /[◮◭⧨⧩]/u),
  );
  for (let index = 1; index < beaconColumns.length; index += 1) {
    const previous = beaconColumns[index - 1];
    const current = beaconColumns[index];
    assert(previous !== undefined && current !== undefined);
    assert(
      Math.abs(current - previous) <= 4,
      `beacon jumped from column ${previous} to ${current}`,
    );
  }
});
