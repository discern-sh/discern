/**
 * Real-PTY evidence for height-responsive Gate-family dashboards. The harness
 * changes the child terminal with stty while real jobs sleep; no controller
 * resize seam or process mutation inside product code is involved.
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

const CSI = "\x1b[";
const REPAINT = `${CSI}1G`;
const HIDE_CURSOR = `${CSI}?25l`;
const SHOW_CURSOR = `${CSI}?25h`;
const LINT_OUTPUT = "701-PTY-LINT";
const TEST_OUTPUT = "711-PTY-TEST";
const RESIZE_MARKER_ENV = "DISCERN_VIEWPORT_TEST_READY";

type GateVerb = "done" | "prepare" | "test";
type InitialMode = "full" | "compact" | "append";

/** Build a Gate-family fixture with optional resize synchronization. */
function config(resizeReady: boolean): string {
  const beforeSleep = resizeReady ? `touch "$${RESIZE_MARKER_ENV}"; ` : "";
  const sleepSeconds = resizeReady ? 2 : 1;
  const format = resizeReady
    ? `sh -c 'touch "$${RESIZE_MARKER_ENV}"; sleep ${sleepSeconds}'`
    : "sleep 1";
  return [
    "[project]",
    'slug = "gate-viewport-tty"',
    "agents = []",
    "",
    "[repository]",
    'trunk = "main"',
    "",
    "[guidance]",
    "sources = []",
    "",
    "[jobs]",
    `format = ${JSON.stringify(format)}`,
    `lint = ${
      JSON.stringify(
        `sh -c '${beforeSleep}sleep ${sleepSeconds}; echo $((700+1))-PTY-LINT'`,
      )
    }`,
    `test = ${
      JSON.stringify(
        `sh -c '${beforeSleep}sleep ${sleepSeconds}; echo $((710+1))-PTY-TEST'`,
      )
    }`,
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
    assertEquals(blankTailRows, 6);
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
    assertEquals(occurrences(result.output, "Proof: gate passed"), 1);
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

/** Run a resize synchronized to a marker written immediately before job sleep. */
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
  const markerDir = await Deno.makeTempDir({
    prefix: "discern-viewport-ready-",
  });
  const markerPath = join(markerDir, "ready");
  try {
    return await runAgentPtyWithViewport(root, args, {
      size: options.size,
      resize: {
        ...options.resize,
        afterMs: 100,
        whenPath: markerPath,
      },
      env: {
        NO_COLOR: "1",
        CI: "false",
        [RESIZE_MARKER_ENV]: markerPath,
      },
      timeoutMs: 15_000,
    });
  } finally {
    await Deno.remove(markerDir, { recursive: true }).catch(() => undefined);
  }
}

Deno.test({
  name:
    "real terminal heights select full, compact, then append-only for done, prepare, and test",
  ignore: Deno.build.os === "windows",
  fn: async () => {
    const matrix = [
      { mode: "full", columns: 80, rows: 60 },
      { mode: "compact", columns: 80, rows: 4 },
      { mode: "append", columns: 80, rows: 2 },
    ] as const;
    await Promise.all(
      (["done", "prepare", "test"] as const).map(async (verb) => {
        await withVerbFixture(verb, async (root, args) => {
          for (const row of matrix) {
            const result = await runAgentPtyWithViewport(root, args, {
              size: { columns: row.columns, rows: row.rows },
              env: { NO_COLOR: "1", CI: "false" },
              timeoutMs: 15_000,
            });
            assertEquals(result.code, 0, result.output);
            assertEquals(result.terminal.childCode, 0, result.output);
            assertEquals(result.terminal.initialSize, {
              columns: row.columns,
              rows: row.rows,
            });
            assertInitialMode(verb, row.mode, result);
            assertFinalRegionOnce(verb, result);
          }
        });
      }),
    );
  },
});

Deno.test({
  name:
    "real mid-run viewport changes downgrade, upgrade, and safely latch append-only output",
  ignore: Deno.build.os === "windows",
  fn: async () => {
    await Promise.all([
      withVerbFixture("done", async (root, args) => {
        const result = await runObservedResize(root, args, {
          size: { columns: 120, rows: 29 },
          resize: { columns: 40, rows: 29 },
        });
        assertEquals(result.code, 0, result.output);
        assertInitialMode("done", "full", result);
        assertEquals(result.terminal.resizedSize, { columns: 40, rows: 29 });
        assertTerminalTextIncludes(result.output, "Gate");
        assertFinalRegionOnce("done", result);
      }, RESIZE_CONFIG),
      withVerbFixture("prepare", async (root, args) => {
        const result = await runObservedResize(root, args, {
          size: { columns: 80, rows: 4 },
          resize: { columns: 80, rows: 60 },
        });
        assertEquals(result.code, 0, result.output);
        assertInitialMode("prepare", "compact", result);
        assertEquals(result.terminal.resizedSize, { columns: 80, rows: 60 });
        const output = productOutput("prepare", result.stdout);
        const frames = output.split(REPAINT);
        assert(
          frames.some((frame) =>
            frame.split("\n").filter((line) => line.trim() === "│").length >= 6
          ),
          result.output,
        );
        assertFinalRegionOnce("prepare", result);
      }, RESIZE_CONFIG),
      withVerbFixture("test", async (root, args) => {
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
        assertFinalRegionOnce("test", result);
      }, RESIZE_CONFIG),
    ]);
  },
});
