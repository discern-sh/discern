/** Named production Desk frames, captured in real PTYs and projected by the package. */
import { assert, assertEquals } from "@std/assert";
import { resolve } from "@std/path";
import { stripAnsi } from "discern-design-system/cli";
import {
  captureTerminalFrame,
  encodeTerminalKeys,
} from "discern-design-system/cli/interactive/testing";
import { withRealPtyBoundary } from "../tests/real_pty.ts";
import {
  deskCollision,
  deskFailedAction,
  deskFleetEntry,
  deskFleetFixture,
  deskOrphanBranch,
  deskProof,
  deskRunningAction,
  type DeskTtyInputPhase,
  type DeskTtyProject,
  runDeskTty,
  withDeskTtyProject,
} from "../tests/fixtures/desk_tty_harness.ts";
import type { PtyGeometry } from "../tests/fixtures/pty_process.ts";

/** Observe a complete named state before sending its next key sequence. */
function phase(
  name: string,
  includes: [string, ...string[]],
  input: string,
): DeskTtyInputPhase {
  return {
    waitFor: {
      description: `Visible frame markers: ${includes.join(", ")}`,
      test: (output) =>
        [output.phaseStdout, output.phaseStderr].some((text) =>
          includes.every((marker) => stripAnsi(text).includes(marker))
        ),
    },
    capture: { name, when: { includes } },
    chunks: [{
      input,
      ...(input.endsWith(encodeTerminalKeys("escape"))
        ? { allowLoneEscape: true }
        : {}),
    }],
  };
}

/** Capture a production journey and keep per-viewport evidence, never stitched scrollback. */
async function capture(
  project: DeskTtyProject,
  directory: string,
  name: string,
  geometry: PtyGeometry,
  input: readonly DeskTtyInputPhase[],
): Promise<string[]> {
  const plain = geometry.columns === 40;
  const result = await runDeskTty(project, {
    geometry,
    input,
    colorMode: plain ? "no-color-env" : "color",
    theme: geometry.rows === 50 ? "light" : "dark",
    env: {
      LANG: plain ? "C" : "en_US.UTF-8",
      LC_ALL: plain ? "C" : "en_US.UTF-8",
    },
  });
  assertEquals(result.code, 0, result.transcript);
  assert(result.terminal.restored && result.terminal.noChild);
  const artifacts: string[] = [];
  for (const [state, raw] of Object.entries(result.keyframes)) {
    const frame = captureTerminalFrame(raw, geometry, {
      theme: geometry.rows === 50 ? "light" : "dark",
    });
    const id = `${name}-${geometry.columns}x${geometry.rows}-${state}`;
    await Deno.writeTextFile(
      `${directory}/${id}.html`,
      `<!doctype html><meta charset="utf-8"><title>${id}</title>${frame.html}`,
    );
    await Deno.writeTextFile(
      `${directory}/${id}.json`,
      JSON.stringify(
        {
          geometry,
          frame: frame.frame,
          inspection: frame.geometry,
          terminal: result.terminal,
        },
        null,
        2,
      ) + "\n",
    );
    artifacts.push(`${id}.html`);
    console.log(`${directory}/${id}.html`);
  }
  return artifacts;
}

/** Produce the bounded review gallery without asserting current pixels as expected output. */
async function main(): Promise<void> {
  const directory = resolve(Deno.args[0] ?? ".scratch/desk-review");
  await Deno.mkdir(directory, { recursive: true });
  const artifacts: string[] = [];
  await withRealPtyBoundary({
    name: "production Desk named-state gallery",
    contracts: [
      "control-rendering",
      "terminal-modes",
      "process-lifecycle",
      "platform-transport",
    ],
    canary: false,
  }, async () => {
    for (const empty of [true, false]) {
      const fixture = deskFleetFixture(
        empty
          ? []
          : Array.from({ length: 16 }, (_, i) =>
            deskFleetEntry(`task-${String(i).padStart(2, "0")}-a1b2c3`, {
              aheadCommits: 1,
              ...(i === 0
                ? {
                  proof: deskProof({
                    line: "Proof: gallery fixture",
                    markdown: "# Complete Proof\n\n" +
                      Array.from({ length: 60 }, (_, n) =>
                        `Check ${
                          n + 1
                        }: fixture observation retained for review.`).join(
                          "\n\n",
                        ),
                  }),
                }
                : {}),
              ...(i === 1 ? { action: deskRunningAction() } : {}),
              ...(i === 2 ? { action: deskFailedAction() } : {}),
            })),
        empty ? {} : {
          collisions: [deskCollision("shared.ts")],
          orphanBranches: Array.from(
            { length: 12 },
            (_, i) => deskOrphanBranch(`parked-${i}-a1b2c3`),
          ),
        },
      );
      await withDeskTtyProject(fixture, async (project) => {
        for (
          const geometry of [
            { columns: 80, rows: 24 },
            { columns: 120, rows: 30 },
            { columns: 60, rows: 50 },
            { columns: 40, rows: 20 },
            { columns: 80, rows: 13 },
            { columns: 24, rows: 8 },
          ]
        ) {
          const ready = empty ? "No tasks yet" : "Tasks (16)";
          const input = geometry.columns < 32
            ? [phase("minimum", ["Resize to"], "q")]
            : [
              phase("overview", [ready, "/ find"], empty ? "\t" : "\r"),
              phase(empty ? "commands" : "controls", [
                empty ? "Desk commands" : "Task controls",
                "/ find",
              ], "q"),
            ];
          artifacts.push(
            ...await capture(
              project,
              directory,
              empty ? "empty" : "fleet",
              geometry,
              input,
            ),
          );
        }
        if (empty) {
          artifacts.push(
            ...await capture(project, directory, "manual", {
              columns: 80,
              rows: 24,
            }, [
              phase("desk", ["No tasks yet", "/ find"], "\t/manual\r\r"),
              phase(
                "index",
                ["DISCERN DOCS", "Enter open/action  Esc cancel"],
                "Delegate substantial work",
              ),
              phase("search", [
                "Search: Delegate substantial work",
                "10-guides/delegate-work.md",
                "Enter open/action  Esc cancel",
              ], "\r"),
              phase(
                "page",
                ["A substantial idea", "Tab picker  Esc/q close"],
                "]\r",
              ),
              phase("linked", [
                "Wait for another task",
                "Tab picker  Esc/q close",
              ], "q"),
              phase(
                "picker-return",
                ["Enter open/action  Esc cancel"],
                encodeTerminalKeys("escape"),
              ),
              phase("desk-return", ["Desk commands / manual", "/ find"], "q"),
            ]),
          );
          return;
        }
        artifacts.push(
          ...await capture(project, directory, "failure", {
            columns: 80,
            rows: 24,
          }, [
            phase("overview", ["Tasks (16)", "/ find"], "/Task 02\r\r"),
            phase("controls", ["Task controls", "/ find"], "/details\r\r"),
            phase(
              "details",
              ["Branch:", "/ find"],
              encodeTerminalKeys("escape"),
            ),
            phase("controls-return", ["Task controls", "/ find"], "q"),
          ]),
        );
        artifacts.push(
          ...await capture(project, directory, "missing-proof", {
            columns: 80,
            rows: 24,
          }, [
            phase("overview", ["Tasks (16)", "/ find"], "/Task 03\r\r"),
            phase(
              "controls",
              ["Task controls", "/ find"],
              "/proof and changes\r\r",
            ),
            phase("summary", [
              "No complete Proof is available.",
              "Tab choices/read  Esc back",
            ], encodeTerminalKeys("escape")),
            phase("return", ["Task controls", "/ find"], "q"),
          ]),
        );
        for (
          const geometry of [
            { columns: 80, rows: 24 },
            { columns: 40, rows: 20 },
            { columns: 120, rows: 30 },
            { columns: 80, rows: 13 },
          ]
        ) {
          artifacts.push(
            ...await capture(project, directory, "review", geometry, [
              phase("overview", ["Tasks (16)", "/ find"], "\r"),
              phase(
                "controls",
                ["Task controls", "/ find"],
                "/proof and changes\r\r",
              ),
              phase(
                "summary",
                ["Review Task 00", "Tab choices/read  Esc back"],
                encodeTerminalKeys("tab", "down", "enter"),
              ),
              phase(
                "proof",
                ["Complete Proof", "Tab choices/read  Esc back"],
                encodeTerminalKeys("end"),
              ),
              phase("proof-scrolled", [
                "Check 60:",
                "Tab choices/read  Esc back",
              ], encodeTerminalKeys("escape")),
              phase("review-return", [
                "Review Task 00",
                "Tab choices/read  Esc back",
              ], encodeTerminalKeys("escape")),
              phase("returned", ["Task controls", "/ find"], "q"),
            ]),
          );
        }
      });
    }
  });
  await withRealPtyBoundary({
    name: "production Drop cancellation and completion",
    contracts: ["control-rendering", "terminal-modes", "process-lifecycle"],
    canary: false,
  }, async () => {
    await withDeskTtyProject(
      deskFleetFixture([deskFleetEntry("drop-review-a1b2c3")]),
      async (project) => {
        artifacts.push(
          ...await capture(project, directory, "drop", {
            columns: 80,
            rows: 24,
          }, [
            phase("overview", ["Tasks (1)", "/ find"], "\r"),
            phase("controls", ["Task controls", "/ find"], "/drop\r\r"),
            phase(
              "cancel-review",
              ["Drop", "Tab choices/read  Esc back"],
              encodeTerminalKeys("escape"),
            ),
            phase("cancelled", ["Task controls", "/ find"], "\r"),
            phase(
              "apply-review",
              ["Drop", "Tab choices/read  Esc back"],
              encodeTerminalKeys("tab", "down", "enter"),
            ),
            phase("completed", ["No tasks yet", "/ find"], "q"),
          ]),
        );
      },
    );
  });
  await Deno.writeTextFile(
    `${directory}/index.html`,
    `<!doctype html><meta charset="utf-8"><title>Desk review</title><h1>Production Desk review</h1><p>Each link is a complete terminal viewport from a disposable fixture. Proof text is sample evidence. This gallery is for visual judgment, not screenshot comparison tests.</p><ul>${
      artifacts.map((name) => `<li><a href="${name}">${name}</a></li>`).join("")
    }</ul>`,
  );
}
if (import.meta.main) await main();
