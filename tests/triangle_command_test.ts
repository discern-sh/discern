/**
 * `discern triangle` verb behavior — the hidden verb's shared core: the result
 * envelope carries the mark and the composed art, planning keeps motion off
 * non-interactive surfaces, and the animated reveal reuses the gasket motif's
 * timeline before settling on the exact static art.
 */

import { assert, assertEquals, assertStringIncludes } from "@std/assert";
import {
  planTriangleCommand,
  renderTriangleArt,
  runTriangle,
  triangleResult,
} from "../src/commands/triangle.ts";
import { DISCERN_MARK, DISCERN_WORDMARK } from "../src/shared/brand.ts";
import { DISCERN_TRIANGLE_MOTIFS } from "../art/terminal/triangle.ts";
import type { TerminalAnimationEnvironment } from "../src/lib/terminal_animation.ts";

const CAPABLE_TERMINAL: TerminalAnimationEnvironment = {
  stdoutIsTerminal: true,
  ci: undefined,
  term: "xterm-256color",
  terminalColumns: 80,
  terminalRows: 24,
};

Deno.test("triangleResult carries the mark and the composed terminal art", () => {
  const result = triangleResult();
  assert(result.ok);
  assertEquals(result.verb, "triangle");
  assert(result.data !== undefined);
  assertEquals(result.data.mark, DISCERN_MARK);
  assertEquals(result.data.art, renderTriangleArt());

  const art = result.data.art;
  assertEquals(art.split("\n")[0], `       ${DISCERN_MARK}`);
  assert(art.endsWith(`\n\n   ${DISCERN_WORDMARK}`));
  assert(!art.endsWith("\n"));
  for (const character of art) {
    assert(
      character === "\n" || !/[\p{Cc}\p{Cf}]/u.test(character),
      `art contains terminal control ${JSON.stringify(character)}`,
    );
  }
  for (const line of art.split("\n")) {
    assert(!/\s$/u.test(line), `art has trailing whitespace in "${line}"`);
  }
});

Deno.test("triangle planning keeps motion off non-interactive surfaces", () => {
  const staticEnvironments: readonly TerminalAnimationEnvironment[] = [
    { ...CAPABLE_TERMINAL, stdoutIsTerminal: false },
    { ...CAPABLE_TERMINAL, ci: "true" },
    { ...CAPABLE_TERMINAL, term: "dumb" },
    { ...CAPABLE_TERMINAL, terminalColumns: 10 },
    { ...CAPABLE_TERMINAL, terminalRows: 4 },
  ];
  for (const environment of staticEnvironments) {
    const plan = planTriangleCommand(environment, { plain: false });
    assertEquals(plan.mode, "static");
    assert(plan.mode === "static");
    assertEquals(plan.output, `${renderTriangleArt()}\n`);
  }
  const plainPlan = planTriangleCommand(CAPABLE_TERMINAL, { plain: true });
  assertEquals(plainPlan.mode, "static");
});

Deno.test("the animated reveal reuses the gasket motif and settles on the art", () => {
  const plan = planTriangleCommand(CAPABLE_TERMINAL, { plain: false });
  assert(plan.mode === "animate");
  assertEquals(plan.playback.finalTranscript, renderTriangleArt());
  assertEquals(plan.playback.scenes.length, 1);

  const motif = DISCERN_TRIANGLE_MOTIFS.gasket.animate();
  const scene = plan.playback.scenes[0];
  assert(scene !== undefined);
  assertEquals(scene.frameMs, motif.frameMs);
  assertEquals(scene.finalHoldMs, motif.finalHoldMs);
  assertEquals(
    scene.viewports.map((viewport) => viewport.split("\n").slice(1).join("\n")),
    [...motif.frames],
  );
  for (const viewport of scene.viewports) {
    assertStringIncludes(viewport.split("\n")[0] ?? "", DISCERN_WORDMARK);
  }
});

Deno.test("triangle --json emits one faithful result envelope and exits 0", async () => {
  const lines: string[] = [];
  const original = console.log;
  console.log = (...args: unknown[]): void => {
    lines.push(args.map((a) => String(a)).join(" "));
  };
  let code: number;
  try {
    code = await runTriangle({ json: true, noColor: true, plain: false });
  } finally {
    console.log = original;
  }
  assertEquals(code, 0);
  const envelope = JSON.parse(lines.join("\n")) as {
    ok: boolean;
    verb: string;
    data: { mark: string; art: string };
  };
  assertEquals(envelope.ok, true);
  assertEquals(envelope.verb, "triangle");
  assertEquals(envelope.data.mark, DISCERN_MARK);
  assertEquals(envelope.data.art, renderTriangleArt());
});
