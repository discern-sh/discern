/** Black-box coverage for `prepare`'s shared gate-job TTY presentation. */

import { assert, assertEquals, assertStringIncludes } from "@std/assert";
import {
  gitInit,
  runAgent,
  runAgentPty,
  scaffoldEngine,
  writeConfig,
} from "./engine_helpers.ts";
import { withTempDir } from "./helpers.ts";

const CSI = `${String.fromCharCode(27)}[`;
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

Deno.test("prepare TTY: an 80-column live table moves every job through execution", async () => {
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
    assertStringIncludes(result.output, "JOB");
    assertStringIncludes(result.output, "COMMAND");
    assertStringIncludes(result.output, "RESULT");
    assertStringIncludes(result.output, "format");
    assertStringIncludes(result.output, "sleep 1");
    assertStringIncludes(result.output, "lint");
    assertStringIncludes(result.output, "ok · 1s");

    const firstRedraw = result.stdout.indexOf(CSI);
    assert(firstRedraw > 0, result.output);
    const firstFrame = result.stdout.slice(0, firstRedraw);
    assertStringIncludes(firstFrame, "format");
    assertStringIncludes(firstFrame, "lint");
    assertStringIncludes(firstFrame, "pending");
    assertStringIncludes(result.stdout.slice(firstRedraw), "running");
    assertEquals(result.output.includes("Applying fixers"), false);
    assertEquals(result.output.includes("── format"), false);

    const passed = result.stdout.lastIndexOf(
      "Fix and check stages passed. Build and test stages did not run.",
    );
    assert(passed > result.stdout.lastIndexOf("ok · 1s"), result.stdout);
    assert(passed > result.stdout.lastIndexOf(CSI), result.stdout);
    assertEquals(SGR.test(result.output), false);
  });
});

Deno.test("prepare TTY: a narrow terminal uses the stacked layout", async () => {
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
    assertStringIncludes(result.output, "JOB / RESULT");
    assertStringIncludes(result.output, "format  pending");
    assertStringIncludes(result.output, "    true");
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
    assertStringIncludes(result.output, "failed · <1s");
    assertStringIncludes(result.output, "cancelled");
    const tailStart = result.stdout.indexOf("Failure guide:");
    assert(tailStart > result.stdout.lastIndexOf(CSI), result.stdout);
    assert(
      tailStart > result.stdout.lastIndexOf("failed · <1s"),
      result.stdout,
    );
    const lines = result.stdout.split("\n").filter((line) =>
      line.trim() !== ""
    );
    const last = lines.at(-1) ?? "";
    assertStringIncludes(last, "discern prepare failed");
    assertStringIncludes(last, `reproduce: ${failing}`);
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
      assertStringIncludes(result.output, "JOB");
      assertStringIncludes(result.output, "COMMAND");
      assertStringIncludes(result.output, "ok · <1s");
      assertEquals(result.output.includes("pending"), false, label);
      assertEquals(result.output.includes("running"), false, label);
      assertEquals(result.output.includes(CSI), false, label);
    });
  }
});

Deno.test("prepare TTY: stream mode keeps the ordinary command transcript", async () => {
  await withTempDir(async (dir) => {
    await preparedRepo(
      dir,
      config(
        [
          'format = "echo streamed-fix"',
          'lint = "echo streamed-check"',
        ],
        ["stream = true"],
      ),
    );

    const result = await runAgentPty(dir, ["prepare"], {
      env: { COLUMNS: "80", NO_COLOR: "1", CI: "false" },
      timeoutMs: 20_000,
    });
    assertEquals(result.code, 0, result.output);
    assertStringIncludes(result.output, "Applying fixers");
    assertStringIncludes(result.output, "streamed-fix");
    assertStringIncludes(result.output, "streamed-check");
    assertStringIncludes(result.output, "── format");
    assertEquals(result.output.includes("JOB / RESULT"), false);
    assertEquals(result.output.includes("JOB                 COMMAND"), false);
    assertEquals(result.output.includes(CSI), false);
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
    assertStringIncludes(piped.output, "Applying fixers");
    assertStringIncludes(piped.output, "buffered-fix");
    assertStringIncludes(piped.output, "── format");
    assertStringIncludes(
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
    assertStringIncludes(result.output, "(no job is wired — nothing ran)");
    assertStringIncludes(
      result.output,
      "No fix or check job is configured. Build and test stages did not run.",
    );
  });
});
