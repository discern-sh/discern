/** Package provenance and product-composition contracts for terminal triangles. */

import { assert, assertEquals, assertThrows } from "@std/assert";
import {
  DISCERN_TRIANGLE_ASCII_GLYPHS as PACKAGE_ASCII_GLYPHS,
  DISCERN_TRIANGLE_GLYPHS as PACKAGE_GLYPHS,
  DISCERN_TRIANGLE_SPINNER_ORDER as PACKAGE_SPINNER_ORDER,
  DISCERN_TRIANGLE_WEAVE_ORDER as PACKAGE_WEAVE_ORDER,
  renderTimelineCli as renderPackageTimeline,
  renderTriangleActivityBeacon as renderPackageBeacon,
  renderTrianglePattern as renderPackagePattern,
  renderTriangleProgressFrame as renderPackageProgress,
  renderTriangleSectionRule as renderPackageSectionRule,
  renderTriangleSpinnerFrame as renderPackageSpinner,
  renderTriangleWorkflowStepper as renderPackageStepper,
  stripAnsi,
  type TerminalCapabilities,
} from "discern-design-system/cli";
import {
  DISCERN_PACKAGE_TRIANGLE_MOTIFS,
  DISCERN_PRODUCT_TRIANGLE_ART,
  DISCERN_TRIANGLE_ASCII_GLYPHS,
  DISCERN_TRIANGLE_GLYPHS,
  DISCERN_TRIANGLE_SPINNER_ORDER,
  DISCERN_TRIANGLE_WEAVE_ORDER,
  MAX_TRIANGLE_ART_CELLS,
  renderTriangleGasket,
  renderTrianglePyramid,
} from "../art/terminal/triangle.ts";

const UNICODE: TerminalCapabilities = {
  colorDepth: "none",
  columns: 120,
  unicode: true,
};
const ASCII: TerminalCapabilities = {
  colorDepth: "none",
  columns: 120,
  unicode: false,
};
const TRUECOLOR: TerminalCapabilities = {
  colorDepth: "truecolor",
  columns: 120,
  unicode: true,
};

const STEPS = ["inspect", "plan", "apply", "verify"] as const;

/** Render every reusable specimen directly from its public package function. */
function packageMotifFrames(
  terminalFacts: TerminalCapabilities,
): Readonly<Record<keyof typeof DISCERN_PACKAGE_TRIANGLE_MOTIFS, string>> {
  const spinner = PACKAGE_SPINNER_ORDER.map((_, phase) =>
    renderPackageSpinner(phase, terminalFacts)
  ).join(" -> ");
  return {
    divider: renderPackagePattern({ length: 32 }, terminalFacts),
    ribbon: renderPackagePattern(
      { length: 24, thickness: 3 },
      terminalFacts,
    ),
    weave: renderPackagePattern(
      { length: 8, orientation: "vertical", thickness: 4 },
      terminalFacts,
    ),
    spinner: `${spinner} -> (repeat)`,
    progress: renderPackageProgress(
      { completed: 25, total: 100, width: 40 },
      terminalFacts,
    ),
    "section-rule": renderPackageSectionRule(
      "quality gate",
      { width: 30 },
      terminalFacts,
    ),
    stepper: renderPackageStepper(
      STEPS.map((label, index) => ({
        label,
        status: index < 3 ? "complete" as const : "active" as const,
        phase: index,
      })),
      terminalFacts,
    ),
    beacon: renderPackageBeacon(
      { width: 32, phase: 14 },
      terminalFacts,
    ),
  };
}

Deno.test("Discern re-exports the published triangle vocabulary by identity", () => {
  assert(DISCERN_TRIANGLE_ASCII_GLYPHS === PACKAGE_ASCII_GLYPHS);
  assert(DISCERN_TRIANGLE_GLYPHS === PACKAGE_GLYPHS);
  assert(DISCERN_TRIANGLE_WEAVE_ORDER === PACKAGE_WEAVE_ORDER);
  assert(DISCERN_TRIANGLE_SPINNER_ORDER === PACKAGE_SPINNER_ORDER);
});

Deno.test("vertical timeline triangles follow status rather than list position", () => {
  for (const terminalFacts of [UNICODE, ASCII]) {
    const glyphs = terminalFacts.unicode
      ? PACKAGE_GLYPHS
      : PACKAGE_ASCII_GLYPHS;
    for (const completeFirst of [true, false]) {
      const complete = {
        date: "Now",
        title: "Complete",
        description: "Finished evidence.",
        status: "complete" as const,
      };
      const incomplete = {
        date: "Later",
        title: "Incomplete",
        description: "Evidence remains.",
        status: "upcoming" as const,
      };
      const rendered = stripAnsi(renderPackageTimeline({
        title: "Status direction",
        items: completeFirst ? [complete, incomplete] : [incomplete, complete],
        maxWidth: 80,
      }, terminalFacts));
      const completeLine = rendered.split("\n").find((line) =>
        line.includes("Complete [complete]")
      );
      const incompleteLine = rendered.split("\n").find((line) =>
        line.includes("Incomplete [upcoming]")
      );
      assert(completeLine !== undefined);
      assert(incompleteLine !== undefined);
      assertEquals(completeLine.at(0), glyphs.upLeft);
      assertEquals(incompleteLine.at(0), glyphs.downRight);
    }
  }
});

Deno.test("every reusable motif is byte-for-byte its public package API", () => {
  for (const terminalFacts of [UNICODE, ASCII, TRUECOLOR]) {
    const expected = packageMotifFrames(terminalFacts);
    for (
      const [name, variant] of Object.entries(
        DISCERN_PACKAGE_TRIANGLE_MOTIFS,
      )
    ) {
      assertEquals(
        variant.render(terminalFacts),
        expected[name as keyof typeof expected],
        `${name} at ${terminalFacts.colorDepth}/${terminalFacts.unicode}`,
      );
    }
  }
});

Deno.test("package motif animation uses package frames and ends at static", () => {
  for (const terminalFacts of [UNICODE, ASCII]) {
    for (
      const [name, variant] of Object.entries(
        DISCERN_PACKAGE_TRIANGLE_MOTIFS,
      )
    ) {
      const animation = variant.animate(terminalFacts);
      assert(animation.frames.length > 1, `${name} needs visible motion`);
      assertEquals(
        animation.frames.at(-1),
        variant.render(terminalFacts),
        name,
      );
      assertEquals(animation, variant.animate(terminalFacts), name);
      for (const frame of animation.frames) {
        assert(frame !== "", `${name} has an empty frame`);
        assert(!frame.endsWith("\n"), `${name} owns a final newline`);
        const plain = stripAnsi(frame);
        for (const character of plain) {
          assert(
            character === "\n" || !/[\p{Cc}\p{Cf}]/u.test(character),
            `${name} contains a terminal control`,
          );
        }
      }
    }
  }
  const spinner = DISCERN_PACKAGE_TRIANGLE_MOTIFS.spinner.animate(UNICODE);
  assertEquals(
    spinner.frames.slice(0, PACKAGE_SPINNER_ORDER.length),
    PACKAGE_SPINNER_ORDER.map((_, phase) =>
      renderPackageSpinner(phase, UNICODE)
    ),
  );
});

Deno.test("product pyramid and gasket derive Unicode and ASCII from package facts", () => {
  const unicodePyramid = renderTrianglePyramid({
    rows: 8,
    capabilities: UNICODE,
  });
  const asciiPyramid = renderTrianglePyramid({ rows: 8, capabilities: ASCII });
  for (
    const [label, pyramid, authority] of [
      ["Unicode", unicodePyramid, PACKAGE_GLYPHS],
      ["ASCII", asciiPyramid, PACKAGE_ASCII_GLYPHS],
    ] as const
  ) {
    const authorityGlyphs = new Set<string>(Object.values(authority));
    const productGlyphs = new Set(pyramid.replaceAll(/[\s]/gu, ""));
    assertEquals(
      productGlyphs,
      authorityGlyphs,
      `${label} product art must use every glyph from its package authority`,
    );
    for (const glyph of pyramid.replaceAll(/[\s]/gu, "")) {
      assert(
        authorityGlyphs.has(glyph),
        `${label} product art used non-package glyph ${glyph}`,
      );
    }
  }

  assertEquals(
    renderTriangleGasket({ rows: 8, levels: 0, capabilities: UNICODE }),
    unicodePyramid,
  );
  assertEquals(
    renderTriangleGasket({ rows: 8, levels: 0, capabilities: ASCII }),
    asciiPyramid,
  );
  const full = renderTriangleGasket({ rows: 8, capabilities: UNICODE });
  assertEquals(
    [...full].filter((glyph) =>
      glyph === PACKAGE_GLYPHS.upRight || glyph === PACKAGE_GLYPHS.upLeft
    ).length,
    27,
  );
  assert(!full.includes(PACKAGE_GLYPHS.downLeft));
  assert(!full.includes(PACKAGE_GLYPHS.downRight));
});

Deno.test("product-only compositions keep deterministic static and final frames", () => {
  assertEquals(Object.keys(DISCERN_PRODUCT_TRIANGLE_ART), [
    "pyramid",
    "gasket",
  ]);
  for (const terminalFacts of [UNICODE, ASCII]) {
    for (
      const [name, variant] of Object.entries(
        DISCERN_PRODUCT_TRIANGLE_ART,
      )
    ) {
      const staticArt = variant.render(terminalFacts);
      const animation = variant.animate(terminalFacts);
      assertEquals(animation.frames.at(-1), staticArt, name);
      assertEquals(animation, variant.animate(terminalFacts), name);
      assert(!staticArt.endsWith("\n"));
      for (const line of staticArt.split("\n")) {
        assert(!/\s$/u.test(line), `${name} has trailing whitespace`);
      }
    }
  }
});

Deno.test("product triangle compositions reject impossible frames", () => {
  const invalid = [
    () => renderTrianglePyramid({ rows: 0 }),
    () => renderTrianglePyramid({ rows: 2, phase: 0.5 }),
    () => renderTrianglePyramid({ rows: 101 }),
    () => renderTriangleGasket({ rows: 0 }),
    () => renderTriangleGasket({ rows: 6 }),
    () => renderTriangleGasket({ rows: 8, levels: 4 }),
    () => renderTriangleGasket({ rows: 8, levels: -1 }),
    () => renderTriangleGasket({ rows: 4, phase: 0.5 }),
    () => renderTriangleGasket({ rows: 128 }),
    () => renderTrianglePyramid({ rows: MAX_TRIANGLE_ART_CELLS }),
  ];
  for (const render of invalid) assertThrows(render, TypeError);
});
