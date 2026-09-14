/** Capture the consumer adoption fixture using the shared, declared PTY adapter. */
import { assert, assertEquals, assertStringIncludes } from "@std/assert";
import { resolve } from "@std/path";
import { TERMINAL_APPLICATION_MINIMUM } from "discern-design-system/cli/interactive";
import { projectTerminalSpans } from "discern-design-system/cli/projection";
import {
  captureTerminalFrame,
  encodeTerminalKeys,
} from "discern-design-system/cli/interactive/testing";
import { runPtyProcess } from "../tests/fixtures/pty_process.ts";
import {
  APPLICATION_FIXTURE_ROOT,
  applicationFrameReady,
  applicationProcessArgs,
} from "../tests/fixtures/terminal_application_capture.ts";
import { withRealPtyBoundary } from "../tests/real_pty.ts";

/** Produce review artifacts without admitting a second transport implementation. */
async function main(): Promise<void> {
  const directory = resolve(Deno.args[0] ?? ".scratch/terminal-application");
  await Deno.mkdir(directory, { recursive: true });
  await withRealPtyBoundary({
    name: "consumer application visual matrix",
    contracts: [
      "control-rendering",
      "terminal-modes",
      "platform-transport",
      "line-discipline",
    ],
    canary: false,
  }, async () => {
    for (
      const geometry of [
        { columns: 80, rows: 24 },
        { columns: 120, rows: 30 },
        { columns: 60, rows: 50 },
        { columns: 24, rows: 8 },
      ]
    ) {
      for (const plain of [false, true]) {
        const name = `${geometry.columns}x${geometry.rows}-${
          plain ? "ascii" : "color"
        }`;
        const ready = applicationFrameReady(geometry);
        const fits = geometry.columns >= TERMINAL_APPLICATION_MINIMUM.columns &&
          geometry.rows >= TERMINAL_APPLICATION_MINIMUM.rows;
        const reading = applicationFrameReady(geometry, "Field notes");
        const handoff = geometry.columns === 80 && !plain;
        const result = await runPtyProcess({
          command: Deno.execPath(),
          args: applicationProcessArgs(Deno.args[1]),
          cwd: APPLICATION_FIXTURE_ROOT,
          geometry,
          env: {
            LANG: plain ? "C" : "en_US.UTF-8",
            LC_ALL: plain ? "C" : "en_US.UTF-8",
            NO_COLOR: plain ? "1" : "",
            FORCE_COLOR: plain ? "" : "1",
            COLORTERM: plain ? "" : "truecolor",
          },
          input: [
            {
              waitFor: ready,
              capture: { name: "application", when: ready },
              steps: fits ? [{ bytes: handoff ? "\r" : "\t" }] : [{
                bytes: encodeTerminalKeys("escape"),
                allowLoneEscape: true,
              }],
            },
            ...(handoff
              ? [
                { waitFor: "CHILD_READY", steps: [{ bytes: "hello\n" }] },
                {
                  waitFor: ready,
                  capture: { name: "returned", when: ready },
                  steps: [{ bytes: "\t" }],
                },
              ]
              : []),
            ...(fits
              ? [{
                waitFor: reading,
                capture: { name: "reading", when: reading },
                steps: [{
                  bytes: encodeTerminalKeys("escape"),
                  allowLoneEscape: true,
                }],
              }]
              : []),
          ],
        });
        assertEquals(result.code, 0, result.transcript);
        if (handoff) {
          assertStringIncludes(result.transcript, "CHILD_RECEIVED_HELLO");
        }
        for (const [phase, transcript] of Object.entries(result.keyframes)) {
          const capture = captureTerminalFrame(transcript, geometry);
          if (plain) {
            assert(
              [...capture.frame].every((character) =>
                character.charCodeAt(0) < 128
              ),
            );
          }
          if (fits) {
            assertEquals(
              projectTerminalSpans(capture.frame).some((span) =>
                span.style?.color !== undefined
              ),
              !plain,
              "capture color policy",
            );
          }
          const artifact = phase === "application" ? name : `${name}-${phase}`;
          await Deno.writeTextFile(
            `${directory}/${artifact}.html`,
            capture.html,
          );
          await Deno.writeTextFile(
            `${directory}/${artifact}.json`,
            JSON.stringify(
              {
                geometry,
                plain,
                frame: capture.frame,
                inspection: capture.geometry,
                transcript: result.transcript,
              },
              null,
              2,
            ) + "\n",
          );
          console.log(`${directory}/${artifact}.html`);
        }
      }
    }
  });
}

if (import.meta.main) await main();
