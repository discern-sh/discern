/** Black-box coverage for `prepare`'s shared gate-job TTY presentation. */

import { assert, assertEquals, assertStringIncludes } from "@std/assert";
import {
  gitInit,
  runAgent,
  runAgentPty,
  scaffoldEngine,
  writeConfig,
} from "./engine_helpers.ts";
import { assertTerminalTextIncludes, withTempDir } from "./helpers.ts";

const CSI = `${String.fromCharCode(27)}[`;
const REPAINT = `${CSI}1G`;
const SHOW_CURSOR = `${CSI}?25h`;
const SGR = new RegExp(`${String.fromCharCode(27)}\\[[0-9;]*m`, "u");

/** Build the minimal prepare fixture config for one job and gate-mode matrix row. */
function config(
  jobs: readonly string[],
  gate: readonly string[] = [],
): string {
  return [
    "[project]",
    'slug = "prepare-tty-test"',
    "agents = []",
    "",
    "[guidance]",
    "sources = []",
    ...(gate.length > 0 ? ["", "[gate]", ...gate] : []),
    ...(jobs.length > 0 ? ["", "[jobs]", ...jobs] : []),
    "",
  ].join("\n");
}

/** Scaffold and commit a configured project ready for a prepare invocation. */
async function preparedRepo(
  dir: string,
  toml: string,
): Promise<void> {
  await scaffoldEngine(dir, { agents: [] });
  await writeConfig(dir, toml);
  await gitInit(dir);
}

Deno.test("prepare TTY: the live activity frame moves every job through execution", async () => {
  await withTempDir(async (dir) => {
    await preparedRepo(
      dir,
      config([
        'format = "sleep 1"',
        'lint = "true"',
      ]),
    );

    const result = await runAgentPty(dir, ["prepare"], {
      env: { COLUMNS: "80", NO_COLOR: "1", CI: "false" },
      timeoutMs: 20_000,
    });
    assertEquals(result.code, 0, result.output);
    assertStringIncludes(result.output, "Gate");
    assertTerminalTextIncludes(result.output, "format started");
    assertTerminalTextIncludes(result.output, "format passed");
    assertTerminalTextIncludes(result.output, "lint started");
    assertTerminalTextIncludes(result.output, "lint passed");
    assert(result.stdout.includes(REPAINT), result.output);
    assertTerminalTextIncludes(result.output, "Applying fixers");
    assertEquals(result.output.includes("── format"), false);

    const passed = result.stdout.lastIndexOf(
      "Fix and check stages passed. Build and test stages did not run.",
    );
    assert(passed > result.stdout.lastIndexOf("lint passed"), result.stdout);
    assert(passed > result.stdout.lastIndexOf(SHOW_CURSOR), result.stdout);
    assertEquals(SGR.test(result.output), false);
  });
});

Deno.test("prepare TTY: a narrow terminal keeps the stable activity facts", async () => {
  await withTempDir(async (dir) => {
    await preparedRepo(
      dir,
      config([
        'format = "true"',
        'lint = "echo a-check-command-with-detail >/dev/null"',
      ]),
    );

    const result = await runAgentPty(dir, ["prepare"], {
      env: { COLUMNS: "40", NO_COLOR: "1", CI: "false" },
      timeoutMs: 20_000,
    });
    assertEquals(result.code, 0, result.output);
    assertTerminalTextIncludes(result.output, "format passed");
    assertTerminalTextIncludes(result.output, "lint passed");
    assertEquals(result.output.includes("a-check-command-with-detail"), false);
    assert(result.output.includes(REPAINT), "the frame repaints in place");
    assertEquals(result.output.includes("JOB                 COMMAND"), false);
  });
});

Deno.test("prepare TTY: a failed live table completes before the actionable tail", async () => {
  await withTempDir(async (dir) => {
    const failing = "echo PREPARE-BROKE; exit 7";
    await preparedRepo(
      dir,
      config([
        'format = "true"',
        `lint = "${failing}"`,
        'typecheck = "sleep 2"',
      ]),
    );

    const result = await runAgentPty(dir, ["prepare"], {
      env: { COLUMNS: "80", NO_COLOR: "1", CI: "false" },
      timeoutMs: 20_000,
    });
    assertEquals(result.code, 1, result.output);
    assertTerminalTextIncludes(result.output, "lint failed");
    assertTerminalTextIncludes(result.output, "typecheck cancelled");
    const tailStart = result.stdout.indexOf("Failure guide:");
    assert(tailStart > result.stdout.lastIndexOf(SHOW_CURSOR), result.stdout);
    assert(tailStart > result.stdout.indexOf("lint failed"), result.stdout);
    assertTerminalTextIncludes(result.stdout.slice(tailStart), "FAILURE: lint");
    assertTerminalTextIncludes(
      result.stdout.slice(tailStart),
      `Reproduce: $ ${failing}`,
    );
    assertTerminalTextIncludes(result.stdout.slice(tailStart), "Safe to retry");
    assertTerminalTextIncludes(
      result.stdout.slice(tailStart),
      "Failed: discern prepare failed",
    );
    assertTerminalTextIncludes(
      result.stdout.slice(tailStart),
      `reproduce: ${failing}`,
    );
  });
});

Deno.test("prepare TTY: --plain and CI render a static final table", async () => {
  for (
    const { label, args, env } of [
      {
        label: "plain",
        args: ["prepare", "--plain"],
        env: { COLUMNS: "80", NO_COLOR: "1", CI: "false" },
      },
      {
        label: "CI",
        args: ["prepare"],
        env: { COLUMNS: "80", NO_COLOR: "1", CI: "1" },
      },
    ]
  ) {
    await withTempDir(async (dir) => {
      await preparedRepo(
        dir,
        config([
          'format = "true"',
          'lint = "true"',
        ]),
      );
      const result = await runAgentPty(dir, args, {
        env,
        timeoutMs: 20_000,
      });
      assertEquals(result.code, 0, `${label}: ${result.output}`);
      assertTerminalTextIncludes(result.output, "Gate progress");
      assertStringIncludes(result.output, "STEPS");
      assertTerminalTextIncludes(result.output, "passed in <1s");
      assertEquals(result.output.includes("pending"), false, label);
      assertEquals(result.output.includes("running"), false, label);
      assertEquals(result.output.includes(CSI), false, label);
    });
  }
});

Deno.test("prepare TTY: stream mode uses the same live bounded activity frame", async () => {
  await withTempDir(async (dir) => {
    await preparedRepo(
      dir,
      config(
        [
          'format = "echo streamed-fix; sleep 0.2"',
          'lint = "echo streamed-check; sleep 0.2"',
        ],
        ["stream = true"],
      ),
    );

    const result = await runAgentPty(dir, ["prepare"], {
      env: { COLUMNS: "80", NO_COLOR: "1", CI: "false" },
      timeoutMs: 20_000,
    });
    assertEquals(result.code, 0, result.output);
    assertTerminalTextIncludes(result.output, "Applying fixers");
    assertStringIncludes(result.output, "streamed-fix");
    assertStringIncludes(result.output, "streamed-check");
    assertTerminalTextIncludes(result.output, "format │ streamed-fix");
    assertTerminalTextIncludes(result.output, "lint │ streamed-check");
    assertTerminalTextIncludes(result.output, "format passed");
    assertEquals(result.output.includes("── format"), false);
    assertEquals(result.output.includes("JOB / RESULT"), false);
    assertEquals(result.output.includes("JOB                 COMMAND"), false);
    assert(result.output.includes(REPAINT), result.output);
  });
});

Deno.test("prepare pipe and JSON surfaces keep their non-interactive contracts", async () => {
  await withTempDir(async (dir) => {
    await preparedRepo(
      dir,
      config([
        'format = "echo buffered-fix"',
        'lint = "true"',
      ]),
    );

    const piped = await runAgent(dir, ["prepare"]);
    assertEquals(piped.code, 0, piped.output);
    assertTerminalTextIncludes(piped.output, "Applying fixers");
    assertStringIncludes(piped.output, "buffered-fix");
    assertTerminalTextIncludes(piped.output, "── format");
    assertTerminalTextIncludes(
      piped.output,
      "Fix and check stages passed. Build and test stages did not run.",
    );
    assertEquals(piped.output.includes("JOB                 COMMAND"), false);
    assertEquals(piped.output.includes(CSI), false);
    assertEquals(SGR.test(piped.output), false);

    const json = await runAgent(dir, ["prepare", "--json"]);
    assertEquals(json.code, 0, json.output);
    const envelope = JSON.parse(json.stdout.trim()) as {
      ok: boolean;
      verb: string;
    };
    assertEquals(envelope.ok, true);
    assertEquals(envelope.verb, "prepare");
    assertEquals(json.stderr, "");
    assertEquals(json.stdout.includes("JOB"), false);
    assertEquals(json.stdout.includes("Fix and check stages passed"), false);
  });
});

Deno.test("prepare TTY: a no-op names the missing fix and check jobs", async () => {
  await withTempDir(async (dir) => {
    await preparedRepo(dir, config([]));
    const result = await runAgentPty(dir, ["prepare"], {
      env: { COLUMNS: "80", NO_COLOR: "1", CI: "false" },
      timeoutMs: 20_000,
    });
    assertEquals(result.code, 0, result.output);
    assertTerminalTextIncludes(
      result.output,
      "No fix or check job is configured. Build and test stages did not",
    );
    assertStringIncludes(result.output, "run.");
  });
});
