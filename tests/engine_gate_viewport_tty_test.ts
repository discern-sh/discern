/**
 * Real-PTY evidence for height-responsive Gate-family dashboards. The harness
 * changes the child terminal with stty while a job awaits acknowledgement;
 * no controller resize seam or process mutation inside product code is involved.
 */

import { assert, assertEquals, assertStringIncludes } from "@std/assert";
import { join } from "@std/path";
import {
  addWorktree,
  git,
  gitInit,
  runAgentPtyWithViewport,
  scaffoldEngine,
  type ViewportRunResult,
  writeConfig,
} from "./engine_helpers.ts";
import { assertTerminalTextIncludes, withTempDir } from "./helpers.ts";
import { realPtyTest } from "./real_pty.ts";
import { shellBarrier } from "./shell_barrier.ts";

const CSI = "\x1b[";
const REPAINT = `${CSI}1G`;
const HIDE_CURSOR = `${CSI}?25l`;
const SHOW_CURSOR = `${CSI}?25h`;
const LINT_OUTPUT = "701-PTY-LINT";
const TEST_OUTPUT = "711-PTY-TEST";
const RESIZE_RELEASE_ENV = "DISCERN_VIEWPORT_TEST_RELEASE";
const RESIZE_ACK_ENV = "DISCERN_VIEWPORT_TEST_RESIZE_ACK";

type GateVerb = "done" | "prepare" | "test";
type InitialMode = "full" | "compact" | "append";

/** Build a Gate-family fixture with optional resize synchronization. */
function config(resizeReady: boolean): string {
  const release = resizeReady
    ? `IFS= read -r acknowledgement < "$${RESIZE_RELEASE_ENV}"; `
    : "";
  return [
    "[project]",
    'slug = "gate-viewport-tty"',
    "agents = []",
    "",
    "[repository]",
    'trunk = "main"',
    "",
    "[instructions]",
    "sources = []",
    "",
    "[jobs]",
    'format = "true"',
    `lint = ${
      JSON.stringify(
        "echo $((700+1))-PTY-LINT",
      )
    }`,
    `test = ${
      JSON.stringify(
        `${release}echo $((710+1))-PTY-TEST`,
      )
    }`,
    ...(resizeReady
      ? [
        "[jobs.resize-probe]",
        'stage = "test"',
        `run = ${
          JSON.stringify(`IFS= read -r acknowledgement < "$${RESIZE_ACK_ENV}"`)
        }`,
      ]
      : []),
    "",
  ].join("\n");
}

const CONFIG = config(false);
const RESIZE_CONFIG = config(true);

/** Run a callback in a configured main checkout or committed linked worktree. */
async function withVerbFixture(
  verb: GateVerb,
  run: (root: string, args: string[]) => Promise<void>,
  fixtureConfig = CONFIG,
): Promise<void> {
  await withTempDir(async (main) => {
    await scaffoldEngine(main, { agents: [] });
    await writeConfig(main, fixtureConfig);
    await gitInit(main);
    if (verb !== "done") {
      await run(main, [verb]);
      return;
    }
    const root = await addWorktree(main, "viewport-done");
    await Deno.writeTextFile(join(root, "viewport-change.txt"), "changed\n");
    await git(root, "add", "-A");
    await git(
      root,
      "commit",
      "-q",
      "-m",
      "Add viewport fixture",
      "--no-gpg-sign",
    );
    await run(root, [verb, "--confirmed"]);
  });
}

/** Return the dashboard title used by one Gate-family verb. */
function title(verb: GateVerb): "Gate" | "Test" {
  return verb === "test" ? "Test" : "Gate";
}

/** Count exact, non-overlapping occurrences of a presentation token. */
function occurrences(text: string, value: string): number {
  return text.split(value).length - 1;
}

/** Remove harness/runtime setup bytes before evaluating product cursor output. */
function productOutput(verb: GateVerb, output: string): string {
  const tokens = [
    HIDE_CURSOR,
    "Applying fixers",
    "Running tests",
  ];
  const starts = tokens.map((token) => output.indexOf(token)).filter((at) =>
    at >= 0
  );
  const start = Math.min(...starts);
  assert(
    Number.isFinite(start),
    `could not find ${verb} product output:\n${output}`,
  );
  return output.slice(start);
}

/** Assert the first physical frame selected the requested presentation mode. */
function assertInitialMode(
  verb: GateVerb,
  mode: InitialMode,
  result: ViewportRunResult,
): void {
  const output = productOutput(verb, result.stdout);
  const firstRepaint = output.indexOf(REPAINT);
  if (mode === "append") {
    assertEquals(
      firstRepaint,
      -1,
      `${verb} append-only start attempted a repaint:\n${result.output}`,
    );
    assertStringIncludes(output.toLowerCase(), title(verb).toLowerCase());
    return;
  }
  assert(firstRepaint > 0, `${verb} did not repaint:\n${result.output}`);
  const firstFrame = output.slice(0, firstRepaint);
  const blankTailRows =
    firstFrame.split("\n").filter((line) => line.trim() === "│").length;
  if (mode === "full") {
    assertStringIncludes(firstFrame, title(verb));
    assertEquals(blankTailRows, 5);
    return;
  }
  assertStringIncludes(firstFrame, title(verb));
  assert(blankTailRows < 6, firstFrame);
}

/** Assert child output stays transient and the stable result region appears once. */
function assertFinalRegionOnce(
  verb: GateVerb,
  result: ViewportRunResult,
): void {
  const expectedOutput = verb === "prepare"
    ? [LINT_OUTPUT]
    : verb === "test"
    ? [TEST_OUTPUT]
    : [LINT_OUTPUT, TEST_OUTPUT];
  for (const marker of expectedOutput) {
    const restored = result.stdout.lastIndexOf(SHOW_CURSOR);
    assert(restored >= 0, result.output);
    assertEquals(
      result.stdout.slice(restored).includes(marker),
      false,
      `${verb} replayed the transient tail below the frame:\n${result.output}`,
    );
  }
  const detail = verb === "test" ? "test passed" : "lint passed";
  assertStringIncludes(result.output, detail);
  if (verb === "done") {
    assertEquals(occurrences(result.output, "Proof: Gate passed"), 1);
  } else if (verb === "prepare") {
    assertEquals(
      occurrences(
        result.output,
        "Fix and check stages passed. Build and test stages did not run.",
      ),
      1,
    );
  } else {
    assertEquals(occurrences(result.output, "Tests passed."), 1);
  }
}

/** Observe the initial frame, resize, then await a new stable fact before output. */
async function runObservedResize(
  root: string,
  args: string[],
  options: {
    readonly size: { readonly columns: number; readonly rows: number };
    readonly resize: {
      readonly columns: number;
      readonly rows: number;
    };
  },
): Promise<ViewportRunResult> {
  return await withTempDir(async (markerDir) => {
    const markerPath = join(markerDir, "ready");
    using barrier = await shellBarrier(join(markerDir, "acknowledgement.fifo"));
    using resized = await shellBarrier(join(markerDir, "resized.fifo"));
    return await runAgentPtyWithViewport(root, args, {
      size: options.size,
      resize: {
        ...options.resize,
        whenPath: markerPath,
        releasePath: resized.path,
      },
      env: {
        NO_COLOR: "1",
        CI: "false",
        [RESIZE_RELEASE_ENV]: barrier.path,
        [RESIZE_ACK_ENV]: resized.path,
      },
      input: [{
        waitFor: "test started",
        steps: [{
          effect: async (): Promise<void> => {
            await Deno.writeTextFile(markerPath, "observed initial frame\n");
          },
        }],
      }, {
        waitFor: "resize-probe passed",
        steps: [{ effect: barrier.release }],
      }],
    });
  }, { prefix: "discern-viewport-ready-" });
}

realPtyTest({
  name: "a real initial terminal height reaches the Gate viewport policy",
  contracts: ["control-rendering", "platform-transport"],
  canary: true,
  ignore: Deno.build.os === "windows",
  fn: async () => {
    await withVerbFixture("test", async (root, args) => {
      const result = await runAgentPtyWithViewport(root, args, {
        size: { columns: 80, rows: 4 },
        env: { NO_COLOR: "1", CI: "false" },
      });
      assertEquals(result.code, 0, result.output);
      assertEquals(result.terminal.childCode, 0, result.output);
      assertEquals(result.terminal.initialSize, { columns: 80, rows: 4 });
      assertInitialMode("test", "compact", result);
      assertFinalRegionOnce("test", result);
    });
  },
});

realPtyTest({
  name: "a real mid-run shrink safely latches append-only Gate output",
  contracts: ["resize-delivery", "control-rendering", "terminal-modes"],
  canary: true,
  ignore: Deno.build.os === "windows",
  fn: async () => {
    await withVerbFixture("test", async (root, args) => {
      const result = await runObservedResize(root, args, {
        size: { columns: 80, rows: 60 },
        resize: { columns: 80, rows: 2 },
      });
      assertEquals(result.code, 0, result.output);
      assertInitialMode("test", "full", result);
      assertEquals(result.terminal.resizedSize, { columns: 80, rows: 2 });
      const output = productOutput("test", result.stdout);
      const refusalAppend = output.indexOf(`│ test │ ${TEST_OUTPUT}`);
      assert(refusalAppend >= 0, result.output);
      assertEquals(
        output.slice(refusalAppend).includes(REPAINT),
        false,
        `unsafe shrink attempted another cursor cleanup:\n${result.output}`,
      );
      assertTerminalTextIncludes(result.output, "Test");
      assertFinalRegionOnce("test", result);
    }, RESIZE_CONFIG);
  },
});
