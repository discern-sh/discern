/** Package provenance and product-composition contracts for terminal triangles. */

import { assert, assertEquals, assertThrows } from "@std/assert";
import {
  DISCERN_TERMINAL_MOTIF,
  renderMotifActivityBeacon as renderPackageBeacon,
  renderMotifPattern as renderPackagePattern,
  renderMotifProgressFrame as renderPackageProgress,
  renderMotifSectionRule as renderPackageSectionRule,
  renderMotifSpinnerFrame as renderPackageSpinner,
  renderMotifWorkflowStepper as renderPackageStepper,
  renderTimelineCli as renderPackageTimeline,
  stripAnsi,
  type TerminalCapabilities,
  terminalMotifRegisterRoles,
  terminalMotifRepertoire,
} from "discern-design-system/cli";
import {
  DISCERN_PACKAGE_TRIANGLE_MOTIFS,
  DISCERN_PRODUCT_TRIANGLE_ART,
  DISCERN_TRIANGLE_ASCII_GLYPHS,
  DISCERN_TRIANGLE_GLYPHS,
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
  const repertoire = terminalMotifRepertoire(
    DISCERN_TERMINAL_MOTIF,
    terminalFacts.unicode,
  );
  const spinner = repertoire.spinner.map((_, phase) =>
    renderPackageSpinner(phase, terminalFacts, {
      motif: DISCERN_TERMINAL_MOTIF,
    })
  ).join(" -> ");
  return {
    divider: renderPackagePattern(
      { length: 32, motif: DISCERN_TERMINAL_MOTIF },
      terminalFacts,
    ),
    ribbon: renderPackagePattern(
      { length: 24, motif: DISCERN_TERMINAL_MOTIF },
      terminalFacts,
    ),
    weave: renderPackagePattern(
      {
        length: 8,
        motif: DISCERN_TERMINAL_MOTIF,
        orientation: "vertical",
      },
      terminalFacts,
    ),
    spinner: `${spinner} -> (repeat)`,
    progress: renderPackageProgress(
      {
        completed: 25,
        motif: DISCERN_TERMINAL_MOTIF,
        total: 100,
        width: 40,
      },
      terminalFacts,
    ),
    "section-rule": renderPackageSectionRule(
      "quality gate",
      { motif: DISCERN_TERMINAL_MOTIF, width: 30 },
      terminalFacts,
    ),
    stepper: renderPackageStepper(
      STEPS.map((label, index) => ({
        label,
        status: index < 3 ? "complete" as const : "active" as const,
        phase: index,
      })),
      terminalFacts,
      { motif: DISCERN_TERMINAL_MOTIF },
    ),
    beacon: renderPackageBeacon(
      { motif: DISCERN_TERMINAL_MOTIF, width: 32, phase: 14 },
      terminalFacts,
    ),
  };
}

Deno.test("Discern derives product triangle geometry from the published motif preset", () => {
  const unicode = terminalMotifRegisterRoles(
    DISCERN_TERMINAL_MOTIF.unicode,
    "brand",
  ).pattern;
  const ascii = terminalMotifRegisterRoles(
    DISCERN_TERMINAL_MOTIF.ascii,
    "brand",
  ).pattern;
  assertEquals(DISCERN_TRIANGLE_GLYPHS, {
    upRight: unicode[0],
    upLeft: unicode[2],
    downLeft: unicode[3],
    downRight: unicode[1],
  });
  assertEquals(DISCERN_TRIANGLE_ASCII_GLYPHS, {
    upRight: ascii[0],
    upLeft: ascii[2],
    downLeft: ascii[3],
    downRight: ascii[1],
  });
});

Deno.test("vertical timeline triangles follow status rather than list position", () => {
  for (const terminalFacts of [UNICODE, ASCII]) {
    const repertoire = terminalMotifRepertoire(
      DISCERN_TERMINAL_MOTIF,
      terminalFacts.unicode,
    );
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
      assertEquals(completeLine.at(0), repertoire.status.complete);
      assertEquals(incompleteLine.at(0), repertoire.status.incomplete);
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
  const spinnerGlyphs = DISCERN_TERMINAL_MOTIF.unicode.spinner;
  assertEquals(
    spinner.frames.slice(0, spinnerGlyphs.length),
    spinnerGlyphs.map((_, phase) =>
      renderPackageSpinner(phase, UNICODE, {
        motif: DISCERN_TERMINAL_MOTIF,
      })
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
      [
        "Unicode",
        unicodePyramid,
        terminalMotifRegisterRoles(
          DISCERN_TERMINAL_MOTIF.unicode,
          "brand",
        ).pattern,
      ],
      [
        "ASCII",
        asciiPyramid,
        terminalMotifRegisterRoles(
          DISCERN_TERMINAL_MOTIF.ascii,
          "brand",
        ).pattern,
      ],
    ] as const
  ) {
    const authorityGlyphs = new Set<string>(authority);
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
      glyph === DISCERN_TRIANGLE_GLYPHS.upRight ||
      glyph === DISCERN_TRIANGLE_GLYPHS.upLeft
    ).length,
    27,
  );
  assert(!full.includes(DISCERN_TRIANGLE_GLYPHS.downLeft));
  assert(!full.includes(DISCERN_TRIANGLE_GLYPHS.downRight));
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
