/**
 * A named PTY keyframe is evidence only once its repaint has fully arrived.
 *
 * A pseudo-terminal delivers one complete-frame repaint across several reads.
 * When a frame's readiness markers sit in its final row, they become visible
 * before that row's padding and style reset do, so a marker-only condition can
 * save a transcript the strict package capture later rejects as incomplete.
 * Every keyframe condition that feeds a strict projection must therefore
 * accept only transcripts that projection accepts; each builder below is swept
 * across every byte prefix of a repaint that follows an earlier paint showing
 * the same markers. Accepting the earlier paint itself is sound: it is complete.
 */

import { assert, assertEquals } from "@std/assert";
import {
  captureTerminalFrame,
  ptyOutputContains,
} from "discern-design-system/cli/interactive/testing";
import { deskKeyframeCondition } from "./fixtures/desk_tty_harness.ts";
import type {
  PtyGeometry,
  PtyObservedOutput,
  PtyOutputCondition,
} from "./fixtures/pty_process.ts";
import { applicationFrameReady } from "./fixtures/terminal_application_capture.ts";
import { settledTerminalCaptureInput } from "./fixtures/terminal_command_capture.ts";

const TITLE = "Review sample";
const FOOTER = "Tab choices/read  Esc back";
const REPAINT = "\x1b[2J\x1b[H";

/** One package-shaped complete repaint whose footer marker is its final row. */
function repaint(geometry: PtyGeometry, body: string): string {
  const pad = (text: string): string => text.padEnd(geometry.columns);
  const rows = [
    `\x1b[1m${pad(TITLE)}\x1b[0m`,
    ...Array.from(
      { length: geometry.rows - 2 },
      (_, index) => pad(`${body} ${index + 1}`),
    ),
    `\x1b[2m${FOOTER}\x1b[0m${" ".repeat(geometry.columns - FOOTER.length)}`,
  ];
  return REPAINT + rows.join("\r\n");
}

/** The observation the package hands a condition after `end` bytes arrived. */
function observed(
  transcript: string,
  phaseStart: number,
  end: number,
): PtyObservedOutput {
  const prefix = transcript.slice(0, end);
  return {
    stdout: prefix,
    stderr: "",
    transcript: prefix,
    phaseStdout: prefix.slice(phaseStart),
    phaseStderr: "",
  };
}

/** Byte counts at which `condition` would save the transcript as a keyframe. */
function readyEnds(
  condition: PtyOutputCondition,
  transcript: string,
  phaseStart: number,
): number[] {
  const ends: number[] = [];
  for (let end = phaseStart; end <= transcript.length; end += 1) {
    if (condition.test(observed(transcript, phaseStart, end))) ends.push(end);
  }
  return ends;
}

/** Whether the package's strict capture accepts one saved transcript. */
function projects(transcript: string, geometry: PtyGeometry): boolean {
  try {
    captureTerminalFrame(transcript, geometry);
    return true;
  } catch {
    return false;
  }
}

const GEOMETRIES: readonly PtyGeometry[] = [
  { columns: 80, rows: 13 },
  { columns: 40, rows: 20 },
];

const BUILDERS: Readonly<
  Record<string, (geometry: PtyGeometry) => PtyOutputCondition>
> = {
  "Desk journeys and galleries": (geometry) =>
    deskKeyframeCondition(
      { name: "sample", when: { includes: [TITLE, FOOTER] } },
      geometry,
      () => [],
      geometry,
    ),
  "terminal command captures": (geometry) => {
    const [phase] = settledTerminalCaptureInput(
      [{
        waitFor: TITLE,
        capture: { name: "sample", when: ptyOutputContains([TITLE, FOOTER]) },
        steps: [{ bytes: "q" }],
      }],
      geometry,
      false,
    );
    assert(phase?.capture !== undefined);
    return phase.capture.when;
  },
  "terminal application captures": (geometry) =>
    applicationFrameReady(geometry, FOOTER),
};

Deno.test("a marker-only keyframe condition can save a repaint the package capture rejects", () => {
  // Witness for the sweep below: without settling, the hazard is reachable.
  for (const geometry of GEOMETRIES) {
    const earlier = `\x1b[?1049h${repaint(geometry, "earlier")}`;
    const transcript = earlier + repaint(geometry, "current");
    const partial = readyEnds(
      ptyOutputContains([TITLE, FOOTER]),
      transcript,
      earlier.length,
    ).filter((end) => !projects(transcript.slice(0, end), geometry));
    assert(
      partial.length > 0,
      `${geometry.columns}x${geometry.rows} fixture no longer exposes a partial final row`,
    );
  }
});

for (const [surface, build] of Object.entries(BUILDERS)) {
  Deno.test(`${surface} save a keyframe only once its repaint is complete`, () => {
    for (const geometry of GEOMETRIES) {
      const earlier = `\x1b[?1049h${repaint(geometry, "earlier")}`;
      const transcript = earlier + repaint(geometry, "current");
      const ends = readyEnds(build(geometry), transcript, earlier.length);
      assertEquals(
        ends.filter((end) => !projects(transcript.slice(0, end), geometry)),
        [],
        `${surface} at ${geometry.columns}x${geometry.rows} accepted a partial repaint`,
      );
      assertEquals(ends.at(-1), transcript.length);
    }
  });
}

Deno.test("a Desk keyframe whose latest paint is inline needs no complete-frame form", () => {
  // Forms paint inline inside the application's screen by erasing below their
  // own origin. The strict capture never projects them, so the in-flight rule
  // applies only while a complete-viewport repaint is the latest paint.
  const geometry = { columns: 80, rows: 24 };
  const form =
    "\x1b[1G\x1b[4A\x1b[JNew task title\n┌──────────┐\n│ Renamed ▌│\n" +
    "└──────────┘";
  const earlier = `\x1b[?1049h${repaint(geometry, "desk")}`;
  const transcript = earlier + form;
  const ends = readyEnds(
    deskKeyframeCondition(
      { name: "form", when: { includes: ["New task title", "Renamed"] } },
      geometry,
      () => [],
      geometry,
    ),
    transcript,
    earlier.length,
  );
  assertEquals(ends.at(-1), transcript.length);
  assertEquals(projects(transcript, geometry), false);
});
