/**
 * Engine tests for metric standards (ADR 0003).
 *
 * Every standard is a `[standards.<name>]` table with a direction (up=floor,
 * down=ceiling), a `limit`, and an inline `run` command that emits
 * `DISCERN_METRIC <name> <number>`. There is no built-in or special standard —
 * "coverage" is just a conventional name. `discern standards` runs them all.
 */

import { assert, assertEquals, assertStringIncludes } from "@std/assert";
import { join } from "@std/path";
import { assertTerminalTextIncludes, withTempDir } from "./helpers.ts";
import {
  git,
  gitInit,
  runAgent,
  scaffoldEngine,
  writeConfig,
} from "./engine_helpers.ts";
import {
  standardPlanIntegrityFailure,
  standardsResult,
} from "../src/engine/gate/standards.ts";
import type { PlannedStandard } from "../src/engine/gate/standard_plan.ts";
import { type Extent, EXTENTS } from "../src/shared/config_schema.ts";
import { GIT_ADMIN_STATE } from "../src/shared/git_admin_state.ts";
import { z } from "@zod/zod";
import {
  type CliResultForCommand,
  decodeCliResult,
  decodeWith,
} from "./decode_cli_result.ts";

type StandardsJson = CliResultForCommand<"standards">;

const StandardMeasurementsSchema = z.object({
  durations: z.record(z.string(), z.number()).optional(),
}).passthrough();

/** Decode a standards envelope and assert the standalone verb produced it. */
function parseStandardsJson(stdout: string): StandardsJson {
  const obj = decodeCliResult(stdout, "standards");
  assertEquals(obj.verb, "standards");
  return obj;
}

/**
 * A config with one `[standards.<name>]` table whose inline `run` emits the
 * metric for either gate or standalone execution.
 */
function standardConfig(opts: {
  name: string;
  metric?: string;
  direction: string;
  limit: string;
  run: string;
  /** Raw TOML for `per`, e.g. `'{ words = "content/**" }'` or `'"words"'`. */
  per?: string;
  scale?: string;
  timeout?: string;
}): string {
  return [
    "[project]",
    'slug = "engine-test"',
    "",
    "[repository]",
    'trunk = "main"',
    "",
    `[standards.${opts.name}]`,
    ...(opts.metric ? [`metric = "${opts.metric}"`] : []),
    `direction = "${opts.direction}"`,
    `limit = ${opts.limit}`,
    ...(opts.per ? [`per = ${opts.per}`] : []),
    ...(opts.scale ? [`scale = ${opts.scale}`] : []),
    ...(opts.timeout ? [`timeout = ${opts.timeout}`] : []),
    `run = "${opts.run}"`,
    "",
  ].join("\n");
}

/** Write a file under `dir`, creating parent dirs — a known-size corpus for a
 * `per = { <extent> = … }` denominator (the file is committed by `gitInit`). */
async function writeText(
  dir: string,
  rel: string,
  content: string,
): Promise<void> {
  const path = `${dir}/${rel}`;
  await Deno.mkdir(path.slice(0, path.lastIndexOf("/")), { recursive: true });
  await Deno.writeTextFile(path, content);
}

/** A tracked file with exactly `wordCount` whitespace-delimited tokens. */
function writeWordFile(
  dir: string,
  rel: string,
  wordCount: number,
): Promise<void> {
  return writeText(dir, rel, Array(wordCount).fill("w").join(" "));
}

Deno.test("standards: coverage passes when the emitted metric meets the floor", async () => {
  await withTempDir(async (dir) => {
    await scaffoldEngine(dir);
    await writeConfig(
      dir,
      standardConfig({
        name: "coverage",
        direction: "up",
        limit: "80",
        run: "echo 'DISCERN_METRIC coverage 85'",
      }),
    );
    await gitInit(dir);
    const r = await runAgent(dir, ["standards"]);
    assertEquals(r.code, 0, r.output);
    assertTerminalTextIncludes(r.stdout, "meets the floor");
    const proof = decodeWith(
      StandardMeasurementsSchema,
      await Deno.readTextFile(
        `${dir}/.git/${GIT_ADMIN_STATE.standardMeasurements.path}`,
      ),
    );
    assertEquals(proof.durations?.coverage, 0);
  });
});

Deno.test("standards: non-dry-run refuses a dirty tree unless forced", async () => {
  await withTempDir(async (dir) => {
    await scaffoldEngine(dir);
    await writeConfig(
      dir,
      standardConfig({
        name: "coverage",
        direction: "up",
        limit: "80",
        run: "echo 'DISCERN_METRIC coverage 85'",
      }),
    );
    await gitInit(dir);
    await Deno.writeTextFile(`${dir}/dirty.txt`, "dirty\n");

    const dry = await runAgent(dir, ["standards", "--dry-run"]);
    assertEquals(dry.code, 0, dry.output);
    assertStringIncludes(dry.stdout, "coverage");

    const blocked = await runAgent(dir, ["standards"]);
    assertEquals(blocked.code, 1, blocked.output);
    assertTerminalTextIncludes(blocked.stderr, "clean worktree");
    assertStringIncludes(blocked.stderr, "--force");

    const blockedJson = await runAgent(dir, ["standards", "--json"]);
    assertEquals(blockedJson.code, 1, blockedJson.output);
    const obj = parseStandardsJson(blockedJson.stdout);
    assertEquals(obj.ok, false);
    assertEquals(obj.error, "dirty_worktree");
    assertStringIncludes(obj.message ?? "", "clean worktree");

    const forced = await runAgent(dir, ["standards", "--force"]);
    assertEquals(forced.code, 0, forced.output);
    assertTerminalTextIncludes(forced.stdout, "meets the floor");
  });
});

Deno.test("standards: a per-standard timeout bounds the standalone measurement", async () => {
  await withTempDir(async (dir) => {
    await scaffoldEngine(dir);
    await writeConfig(
      dir,
      standardConfig({
        name: "slow",
        direction: "up",
        limit: "1",
        timeout: "1",
        run: "sleep 30; echo 'DISCERN_METRIC slow 1'",
      }),
    );
    await gitInit(dir);

    const started = performance.now();
    const run = await runAgent(dir, ["standards", "--json"]);
    const elapsedMs = performance.now() - started;

    assertEquals(run.code, 1, run.output);
    assert(
      elapsedMs < 6_000,
      `the 1s timeout should end promptly, took ${elapsedMs}ms`,
    );
    const result = parseStandardsJson(run.stdout);
    const diagnostic = (result.diagnostics ?? [])[0];
    assertStringIncludes(diagnostic?.message ?? "", "timed out after 1s");
    assertStringIncludes(diagnostic?.reproduce_cmd ?? "", "sleep 30");
    assertEquals((result.steps ?? [])[0]?.duration_s, 1);
  });
});

Deno.test("standardsResult: pre-aborted and mid-run signals cancel promptly", async () => {
  await withTempDir(async (dir) => {
    await scaffoldEngine(dir);
    await writeConfig(
      dir,
      standardConfig({
        name: "slow",
        direction: "up",
        limit: "1",
        run: "sleep 30; echo 'DISCERN_METRIC slow 1'",
      }),
    );
    await gitInit(dir);

    for (const timing of ["pre-aborted", "mid-run"] as const) {
      const controller = new AbortController();
      if (timing === "pre-aborted") {
        controller.abort();
      }
      const started = performance.now();
      const pending = standardsResult(dir, { signal: controller.signal });
      const timer = timing === "mid-run"
        ? setTimeout(() => controller.abort(), 150)
        : undefined;
      const result = await pending;
      if (timer !== undefined) {
        clearTimeout(timer);
      }
      const elapsedMs = performance.now() - started;

      assertEquals(result.ok, false, `${timing}: ${JSON.stringify(result)}`);
      assert(
        elapsedMs < 6_000,
        `${timing} cancellation should end promptly, took ${elapsedMs}ms`,
      );
    }
  });
});

Deno.test("standards: coverage fails when the emitted metric is below the floor", async () => {
  await withTempDir(async (dir) => {
    await scaffoldEngine(dir);
    await writeConfig(
      dir,
      standardConfig({
        name: "coverage",
        direction: "up",
        limit: "80",
        run: "echo 'DISCERN_METRIC coverage 70'",
      }),
    );
    await gitInit(dir);
    const r = await runAgent(dir, ["standards"]);
    assertEquals(r.code, 1, r.output);
    assertTerminalTextIncludes(r.stderr, "below the floor");

    // The envelope carries the reason too: a caller that can't hear the live
    // narration (MCP, --json) must read the same words from diagnostics[], never
    // be left with a bare failed step.
    const json = await runAgent(dir, ["standards", "--json"]);
    assertEquals(json.code, 1, json.output);
    const obj = parseStandardsJson(json.stdout);
    assertEquals(obj.ok, false);
    const diag = (obj.diagnostics ?? [])[0];
    assertEquals(diag?.tool, "coverage", json.stdout);
    assertStringIncludes(diag?.message ?? "", "below the floor 80");
    // The reproduce is the standard's own measurement command, and the applied
    // step's note carries the measured value — no re-measurement needed to see
    // the number.
    assertStringIncludes(
      diag?.reproduce_cmd ?? "",
      "DISCERN_METRIC coverage 70",
    );
    assertStringIncludes((obj.steps ?? [])[0]?.note ?? "", "measured 70");
  });
});

Deno.test("standards: a trailing NN% is NOT read — only the DISCERN_METRIC marker counts", async () => {
  await withTempDir(async (dir) => {
    await scaffoldEngine(dir);
    // No DISCERN_METRIC line — only a trailing percentage. There is no fallback
    // any more, so the metric is unreadable and the standard errors.
    await writeConfig(
      dir,
      standardConfig({
        name: "coverage",
        direction: "up",
        limit: "80",
        run: "echo 'Total coverage: 90%'",
      }),
    );
    await gitInit(dir);
    const r = await runAgent(dir, ["standards"]);
    assertEquals(r.code, 1, r.output);
    assertTerminalTextIncludes(r.stderr, "could not read metric");

    // A metric-reading failure's evidence is the measurement output itself — the
    // diagnostic carries it so a remote caller can see what the command emitted.
    const json = await runAgent(dir, ["standards", "--json"]);
    const obj = parseStandardsJson(json.stdout);
    const diag = (obj.diagnostics ?? [])[0];
    assertStringIncludes(diag?.message ?? "", "could not read metric");
    assertTerminalTextIncludes(diag?.output ?? "", "Total coverage: 90%");
  });
});

Deno.test("standards: a limit may not be lowered vs main", async () => {
  await withTempDir(async (dir) => {
    await scaffoldEngine(dir);
    await writeConfig(
      dir,
      standardConfig({
        name: "coverage",
        direction: "up",
        limit: "80",
        run: "echo 'DISCERN_METRIC coverage 99'",
      }),
    );
    await gitInit(dir); // main now has standards.coverage.limit = 80
    await git(dir, "checkout", "-q", "-b", "agent/x");
    await writeConfig(
      dir,
      standardConfig({
        name: "coverage",
        direction: "up",
        limit: "70",
        run: "echo 'DISCERN_METRIC coverage 99'",
      }),
    );
    await git(dir, "add", "-A");
    await git(dir, "commit", "-q", "-m", "lower the floor", "--no-gpg-sign");

    const r = await runAgent(dir, ["standards"]);
    // A floor may only rise vs main: the never-loosen baseline is read from
    // main's root discern.toml.
    assertEquals(r.code, 1, r.output);
    assertTerminalTextIncludes(r.stderr, "only rises");

    // The envelope distinguishes THIS failure mode from a low measurement: the
    // diagnostic names the loosened limit and both values, and the reproduce is
    // the verb (a structural failure — re-running the measurement proves nothing).
    const json = await runAgent(dir, ["standards", "--json"]);
    const obj = parseStandardsJson(json.stdout);
    const diag = (obj.diagnostics ?? [])[0];
    assertEquals(diag?.tool, "coverage", json.stdout);
    assertStringIncludes(diag?.message ?? "", "floor 80 -> 70");
    assertStringIncludes(diag?.message ?? "", "only rises");
    assertEquals(diag?.reproduce_cmd, "discern standards");
  });
});

Deno.test("standards: a standard deleted from branch config is reported", async () => {
  await withTempDir(async (dir) => {
    await scaffoldEngine(dir);
    await writeConfig(
      dir,
      standardConfig({
        name: "coverage",
        direction: "up",
        limit: "80",
        run: "echo 'DISCERN_METRIC coverage 90'",
      }),
    );
    await gitInit(dir);
    await git(dir, "checkout", "-q", "-b", "agent/delete-standard");
    await writeConfig(
      dir,
      [
        "[project]",
        'slug = "engine-test"',
        "",
        "[repository]",
        'trunk = "main"',
        "",
      ].join("\n"),
    );
    await git(dir, "add", "-A");
    await git(
      dir,
      "commit",
      "-q",
      "-m",
      "delete the standard",
      "--no-gpg-sign",
    );

    const run = await runAgent(dir, ["standards", "--json"]);
    assertEquals(run.code, 1, run.output);
    const result = parseStandardsJson(run.stdout);
    const diagnostic = (result.diagnostics ?? [])[0];
    assertEquals(diagnostic?.tool, "coverage", run.stdout);
    assertStringIncludes(diagnostic?.message ?? "", "deleted on this branch");
    assertEquals(
      result.steps?.map((step) => [step.label, step.outcome]),
      [["coverage", "failed"]],
    );
  });
});

Deno.test("standards: a down-standard ceiling may not be raised vs main", async () => {
  await withTempDir(async (dir) => {
    await scaffoldEngine(dir);
    await writeConfig(
      dir,
      standardConfig({
        name: "bundle",
        direction: "down",
        limit: "100",
        run: "echo 'DISCERN_METRIC bundle 50'",
      }),
    );
    await gitInit(dir); // main now has standards.bundle.limit = 100
    await git(dir, "checkout", "-q", "-b", "agent/x");
    await writeConfig(
      dir,
      standardConfig({
        name: "bundle",
        direction: "down",
        limit: "150",
        run: "echo 'DISCERN_METRIC bundle 50'",
      }),
    );
    await git(dir, "add", "-A");
    await git(dir, "commit", "-q", "-m", "raise the ceiling", "--no-gpg-sign");

    const r = await runAgent(dir, ["standards"]);
    assertEquals(r.code, 1, r.output);
    assertTerminalTextIncludes(r.stderr, "only falls");
  });
});

Deno.test("standards: tightening the limit vs main passes in both directions", async () => {
  const cases = [
    {
      name: "coverage",
      direction: "up",
      mainLimit: "80",
      branchLimit: "90",
      measured: "95",
      message: "meets the floor",
    },
    {
      name: "bundle",
      direction: "down",
      mainLimit: "100",
      branchLimit: "90",
      measured: "80",
      message: "within the ceiling",
    },
  ];

  for (const c of cases) {
    await withTempDir(async (dir) => {
      await scaffoldEngine(dir);
      await writeConfig(
        dir,
        standardConfig({
          name: c.name,
          direction: c.direction,
          limit: c.mainLimit,
          run: `echo 'DISCERN_METRIC ${c.name} ${c.measured}'`,
        }),
      );
      await gitInit(dir);
      await git(dir, "checkout", "-q", "-b", "agent/x");
      await writeConfig(
        dir,
        standardConfig({
          name: c.name,
          direction: c.direction,
          limit: c.branchLimit,
          run: `echo 'DISCERN_METRIC ${c.name} ${c.measured}'`,
        }),
      );
      await git(dir, "add", "-A");
      await git(
        dir,
        "commit",
        "-q",
        "-m",
        `tighten ${c.name}`,
        "--no-gpg-sign",
      );

      const r = await runAgent(dir, ["standards"]);
      assertEquals(r.code, 0, r.output);
      assertStringIncludes(r.stdout, c.message);
    });
  }
});

Deno.test("standards: an up-standard passes at equality with the floor", async () => {
  await withTempDir(async (dir) => {
    await scaffoldEngine(dir);
    await writeConfig(
      dir,
      standardConfig({
        name: "coverage",
        direction: "up",
        limit: "80",
        run: "echo 'DISCERN_METRIC coverage 80'",
      }),
    );
    await gitInit(dir);
    await git(dir, "checkout", "-q", "-b", "agent/x");
    await writeConfig(
      dir,
      standardConfig({
        name: "coverage",
        direction: "up",
        limit: "80",
        run: "echo 'DISCERN_METRIC coverage 80'",
      }),
    );

    const r = await runAgent(dir, ["standards"]);
    assertEquals(r.code, 0, r.output);
    assertTerminalTextIncludes(r.stdout, "meets the floor");
  });
});

Deno.test("standards: a down-standard passes within its ceiling", async () => {
  await withTempDir(async (dir) => {
    await scaffoldEngine(dir);
    await writeConfig(
      dir,
      standardConfig({
        name: "bundle",
        metric: "bundle_bytes",
        direction: "down",
        limit: "100",
        run: "echo 'DISCERN_METRIC bundle_bytes 50'",
      }),
    );
    await gitInit(dir);
    const r = await runAgent(dir, ["standards"]);
    assertEquals(r.code, 0, r.output);
    assertTerminalTextIncludes(r.stdout, "within the ceiling");
    assertTerminalTextIncludes(r.stdout, "standard(s) held");
  });
});

Deno.test("standards: a down-standard fails above its ceiling", async () => {
  await withTempDir(async (dir) => {
    await scaffoldEngine(dir);
    await writeConfig(
      dir,
      standardConfig({
        name: "bundle",
        metric: "bundle_bytes",
        direction: "down",
        limit: "100",
        run: "echo 'DISCERN_METRIC bundle_bytes 150'",
      }),
    );
    await gitInit(dir);
    const r = await runAgent(dir, ["standards"]);
    assertEquals(r.code, 1, r.output);
    assertTerminalTextIncludes(r.stderr, "exceeds the ceiling");
  });
});

Deno.test("standards: an up-standard passes above its floor", async () => {
  await withTempDir(async (dir) => {
    await scaffoldEngine(dir);
    await writeConfig(
      dir,
      standardConfig({
        name: "typecov",
        direction: "up",
        limit: "90",
        run: "echo 'DISCERN_METRIC typecov 95'",
      }),
    );
    await gitInit(dir);
    const r = await runAgent(dir, ["standards"]);
    assertEquals(r.code, 0, r.output);
    assertTerminalTextIncludes(r.stdout, "meets the floor");
  });
});

Deno.test("standards: a misconfigured standard (no run command) errors clearly", async () => {
  await withTempDir(async (dir) => {
    await scaffoldEngine(dir);
    await writeConfig(
      dir,
      [
        "[project]",
        'slug = "engine-test"',
        "",
        "[repository]",
        'trunk = "main"',
        "",
        "[standards.coverage]",
        'direction = "up"',
        "limit = 80",
        // no `run` key at all — nothing to measure. `run` is now schema-required,
        // so this is caught at load with a path-qualified message, not deferred to
        // a runtime "no run command" check.
        "",
      ].join("\n"),
    );
    await gitInit(dir);
    const r = await runAgent(dir, ["standards"]);
    assertEquals(r.code, 1, r.output);
    assertTerminalTextIncludes(r.stderr, "discern.toml is invalid");
    assertStringIncludes(r.stderr, "standards.coverage.run");
  });
});

Deno.test("standards: runs every configured standard, aggregating failures", async () => {
  await withTempDir(async (dir) => {
    await scaffoldEngine(dir);
    // Two standards: coverage holds, bundle fails. Both must run.
    await writeConfig(
      dir,
      [
        "[project]",
        'slug = "engine-test"',
        "",
        "[repository]",
        'trunk = "main"',
        "",
        "[standards.coverage]",
        'direction = "up"',
        "limit = 80",
        "run = \"echo 'DISCERN_METRIC coverage 95'\"",
        "",
        "[standards.bundle]",
        'metric = "bundle_bytes"',
        'direction = "down"',
        "limit = 100",
        "run = \"echo 'DISCERN_METRIC bundle_bytes 150'\"",
        "",
      ].join("\n"),
    );
    await gitInit(dir);
    const r = await runAgent(dir, ["standards"]);
    assertEquals(r.code, 1, r.output);
    // Coverage held (reported) AND the bundle standard failed — both ran.
    assertTerminalTextIncludes(r.stdout, "meets the floor");
    assertTerminalTextIncludes(r.stderr, "exceeds the ceiling");
    assertTerminalTextIncludes(r.stderr, "standards failed");
  });
});

Deno.test("standards --json: a failing standard is a failed step and exit 1", async () => {
  await withTempDir(async (dir) => {
    await scaffoldEngine(dir);
    await writeConfig(
      dir,
      standardConfig({
        name: "bundle",
        direction: "down",
        limit: "100",
        run: "echo 'DISCERN_METRIC bundle 150'",
      }),
    );
    await gitInit(dir);

    const r = await runAgent(dir, ["standards", "--json"]);
    assertEquals(r.code, 1, r.output);
    const obj = parseStandardsJson(r.stdout);
    assertEquals(obj.ok, false);
    assertEquals(obj.steps?.map((s) => [s.label, s.outcome]), [
      ["bundle", "failed"],
    ]);
  });
});

Deno.test("standards: non-numeric emitted metrics fail before comparison", async () => {
  for (const value of ["NaN", "12abc"]) {
    await withTempDir(async (dir) => {
      await scaffoldEngine(dir);
      await writeConfig(
        dir,
        standardConfig({
          name: "coverage",
          direction: "up",
          limit: "80",
          run: `echo 'DISCERN_METRIC coverage ${value}'`,
        }),
      );
      await gitInit(dir);

      const r = await runAgent(dir, ["standards"]);
      assertEquals(r.code, 1, r.output);
      assertTerminalTextIncludes(r.stderr, "is not a number");
      assertStringIncludes(r.stderr, value);
    });
  }
});

Deno.test("standards: a plan/projection length mismatch is a failed integrity step", () => {
  const standard: PlannedStandard = {
    name: "coverage",
    spec: {
      direction: "up",
      limit: 80,
      run: "echo 'DISCERN_METRIC coverage 80'",
      scale: 1,
      margin: 0,
      measure: "gate",
    },
    metric: "coverage",
    direction: "up",
    limit: 80,
    command: "echo 'DISCERN_METRIC coverage 80'",
    limitKey: "standards.coverage.limit",
    scale: 1,
    margin: 0,
    gateMeasure: true,
  };
  const failure = standardPlanIntegrityFailure({ standards: [standard] }, []);
  assert(failure !== undefined, "a mismatch must produce a failed step");
  assertEquals(failure.outcome, "failed");
  assertEquals(failure.step.label, "plan-integrity");
  assertStringIncludes(failure.step.note ?? "", "planned 1 standard(s)");
  assertStringIncludes(failure.step.note ?? "", "projected 0 step(s)");
});

Deno.test("standards: a clean no-op when nothing is configured", async () => {
  await withTempDir(async (dir) => {
    await scaffoldEngine(dir); // default config: no [standards.<name>] tables
    await gitInit(dir);
    const r = await runAgent(dir, ["standards"]);
    assertEquals(r.code, 0, r.output);
    assertTerminalTextIncludes(r.output, "No standards configured");
  });
});

// ── `per`: hold a rate, not a raw count ─────────────────────────────────────────

Deno.test("standards: per a built-in word extent passes within the rate ceiling", async () => {
  await withTempDir(async (dir) => {
    await scaffoldEngine(dir);
    await writeConfig(
      dir,
      standardConfig({
        name: "prose",
        direction: "down",
        limit: "12",
        per: '{ words = "content/**" }',
        scale: "1000",
        run: "echo 'DISCERN_METRIC prose 1'",
      }),
    );
    await writeWordFile(dir, "content/a.txt", 100); // denominator = 100 words
    await gitInit(dir);
    const r = await runAgent(dir, ["standards"]);
    // 1 alert / 100 words * 1000 = 10 per 1,000 words, within the ceiling of 12.
    assertEquals(r.code, 0, r.output);
    assertTerminalTextIncludes(r.stdout, "within the ceiling");
    assertTerminalTextIncludes(r.stdout, "per 100 words");
  });
});

Deno.test("standards: per a built-in word extent fails when the rate exceeds the ceiling", async () => {
  await withTempDir(async (dir) => {
    await scaffoldEngine(dir);
    await writeConfig(
      dir,
      standardConfig({
        name: "prose",
        direction: "down",
        limit: "5",
        per: '{ words = "content/**" }',
        scale: "1000",
        run: "echo 'DISCERN_METRIC prose 1'",
      }),
    );
    await writeWordFile(dir, "content/a.txt", 100);
    await gitInit(dir);
    const r = await runAgent(dir, ["standards"]);
    // 10 per 1,000 words exceeds the ceiling of 5.
    assertEquals(r.code, 1, r.output);
    assertTerminalTextIncludes(r.stderr, "exceeds the ceiling");
    assertTerminalTextIncludes(r.stderr, "per 100 words");
  });
});

Deno.test("standards: per a second emitted metric divides one number by the other", async () => {
  await withTempDir(async (dir) => {
    await scaffoldEngine(dir);
    await writeConfig(
      dir,
      standardConfig({
        name: "warnings",
        metric: "alerts",
        direction: "down",
        limit: "40",
        per: '"words"',
        scale: "1000",
        run:
          "echo 'DISCERN_METRIC alerts 30'; echo 'DISCERN_METRIC words 1000'",
      }),
    );
    await gitInit(dir);
    const r = await runAgent(dir, ["standards"]);
    // 30 alerts / 1000 words * 1000 = 30, within the ceiling of 40.
    assertEquals(r.code, 0, r.output);
    assertTerminalTextIncludes(r.stdout, "within the ceiling");
    assertTerminalTextIncludes(r.stdout, "per 1000");
  });
});

Deno.test("standards: a `per` extent matching nothing errors instead of dividing by zero", async () => {
  await withTempDir(async (dir) => {
    await scaffoldEngine(dir);
    await writeConfig(
      dir,
      standardConfig({
        name: "prose",
        direction: "down",
        limit: "5",
        per: '{ words = "nope/**" }',
        scale: "1000",
        run: "echo 'DISCERN_METRIC prose 1'",
      }),
    );
    await gitInit(dir);
    const r = await runAgent(dir, ["standards"]);
    assertEquals(r.code, 1, r.output);
    assertTerminalTextIncludes(r.stderr, "nothing to divide by");
  });
});

Deno.test("standards: an empty `per` pathspec is refused at load, never measuring the whole repo (B42)", async () => {
  // The end-to-end half of the B42 guard. With `per = { words = [] }`, git's
  // `ls-files --` (no pathspecs) would list EVERY tracked file, making the
  // denominator the whole repo — a wildly wrong, silently-passing rate. The
  // schema now refuses the empty array at load, so `standards` errors with a
  // path-qualified config message and measures nothing at all.
  await withTempDir(async (dir) => {
    await scaffoldEngine(dir);
    await writeConfig(
      dir,
      standardConfig({
        name: "prose",
        direction: "down",
        limit: "5",
        per: "{ words = [] }",
        scale: "1000",
        run: "echo 'DISCERN_METRIC prose 1'",
      }),
    );
    await gitInit(dir);
    const r = await runAgent(dir, ["standards"]);
    assertEquals(r.code, 1, r.output);
    assertTerminalTextIncludes(r.stderr, "discern.toml is invalid");
    assertStringIncludes(r.stderr, "standards.prose.per.words");
    // It must NOT have run a whole-repo measurement — no metric narration leaks.
    assert(!r.stdout.includes("per"), r.output);
  });
});

// ── The class-guard: a rate is invariant under growth; a raw count is not ───────
// This pair is the regression guard for the whole reason `per` exists. If a future
// change made the measured value scale with corpus size again, the first test
// breaks. Drive both off the SAME corpus/metric growth so the contrast is exact.

Deno.test("standards: a rate is invariant under proportional growth (the fix)", async () => {
  await withTempDir(async (dir) => {
    await scaffoldEngine(dir);
    const cfg = standardConfig({
      name: "prose",
      direction: "down",
      limit: "21", // ceiling on the RATE (per 1,000 words)
      per: '{ words = "content/**" }',
      scale: "1000",
      run: "echo DISCERN_METRIC prose $(cat metric.txt)",
    });
    await writeConfig(dir, cfg);
    await Deno.writeTextFile(join(dir, "metric.txt"), "3\n");
    await writeWordFile(dir, "content/a.txt", 150); // 3 / 150 * 1000 = 20.0
    await gitInit(dir);
    const small = await runAgent(dir, ["standards"]);
    assertEquals(small.code, 0, small.output);
    assertTerminalTextIncludes(small.stdout, "within the ceiling");

    // Grow the corpus and the alerts proportionally: density stays 20.0, so the
    // SAME ceiling still holds — growth alone never breaches it.
    await writeWordFile(dir, "content/a.txt", 300);
    await Deno.writeTextFile(join(dir, "metric.txt"), "6\n");
    const grown = await runAgent(dir, ["standards", "--force"]);
    assertEquals(grown.code, 0, grown.output);
    assertTerminalTextIncludes(grown.stdout, "within the ceiling");
  });
});

Deno.test("standards: the same growth breaks a raw count, and the failure points at `per`", async () => {
  await withTempDir(async (dir) => {
    await scaffoldEngine(dir);
    // A raw-count ceiling at the small count (3), no `per`.
    await writeConfig(
      dir,
      standardConfig({
        name: "prose",
        direction: "down",
        limit: "3",
        run: "echo DISCERN_METRIC prose $(cat metric.txt)",
      }),
    );
    await Deno.writeTextFile(join(dir, "metric.txt"), "3\n");
    await gitInit(dir);
    const small = await runAgent(dir, ["standards"]);
    assertEquals(small.code, 0, small.output); // 3 within the ceiling of 3

    // Same proportional growth as the rate test — but a raw count rises with size
    // and breaches the ceiling, the exact trap `per` removes.
    await Deno.writeTextFile(join(dir, "metric.txt"), "6\n");
    const grown = await runAgent(dir, ["standards", "--force"]);
    assertEquals(grown.code, 1, grown.output);
    assertTerminalTextIncludes(grown.stderr, "exceeds the ceiling");
    assertTerminalTextIncludes(grown.stderr, "hold a rate"); // the normalize hint
  });
});

// ── Every built-in extent measures the right denominator (class guard) ─────────
// A fixture per built-in extent: a known corpus whose denominator the breakdown
// must report. Keyed by extent so the guard can assert it covers EXACTLY the
// EXTENTS SSOT — a new measure added to the vocabulary forces a case here rather
// than shipping with a silently-untested counter branch. Each run emits a 0
// numerator, so the rate is 0 regardless and only the measured denominator shows.
const EXTENT_CASES: Record<
  Extent,
  { files: Array<[string, string]>; per: string; expect: string }
> = {
  files: {
    files: [["content/a.txt", "w"], ["content/b.txt", "w"], [
      "content/c.txt",
      "w",
    ]],
    per: '{ files = "content/**" }',
    expect: "per 3 files",
  },
  lines: {
    files: [["content/x.txt", "a\nb\nc\nd\n"]], // 4 newlines
    per: '{ lines = "content/**" }',
    expect: "per 4 lines",
  },
  words: {
    files: [["content/a.txt", Array(100).fill("w").join(" ")]], // 100 words
    per: '{ words = "content/**" }',
    expect: "per 100 words",
  },
  bytes: {
    files: [["content/x.txt", "abcdefghij"]], // 10 bytes
    per: '{ bytes = "content/**" }',
    expect: "per 10 bytes",
  },
};

Deno.test("standards: EVERY built-in extent measures its own denominator", async () => {
  // SSOT coupling: the cases name EXACTLY the EXTENTS vocabulary — a new extent
  // can't ship without a denominator case here, and a removed one can't leave a
  // dead case behind. This is the tie that auto-enrols the next measure.
  assertEquals(
    Object.keys(EXTENT_CASES).sort(),
    [...EXTENTS].sort(),
    "EXTENT_CASES must cover exactly the EXTENTS SSOT — add/remove a case for the changed extent",
  );

  for (const measure of EXTENTS) {
    const c = EXTENT_CASES[measure];
    await withTempDir(async (dir) => {
      await scaffoldEngine(dir);
      await writeConfig(
        dir,
        standardConfig({
          name: "r",
          direction: "down",
          limit: "1",
          per: c.per,
          run: "echo 'DISCERN_METRIC r 0'",
        }),
      );
      for (const [rel, content] of c.files) await writeText(dir, rel, content);
      await gitInit(dir);
      const r = await runAgent(dir, ["standards"]);
      assertEquals(r.code, 0, `${measure}: ${r.output}`);
      assertStringIncludes(
        r.stdout,
        c.expect,
        `the ${measure} extent must report "${c.expect}" in the breakdown`,
      );
    });
  }
});

Deno.test("standards: a `per` metric the run never emits errors clearly", async () => {
  await withTempDir(async (dir) => {
    await scaffoldEngine(dir);
    await writeConfig(
      dir,
      standardConfig({
        name: "warnings",
        metric: "alerts",
        direction: "down",
        limit: "10",
        per: '"words"', // but the run emits no `words` metric
        scale: "1000",
        run: "echo 'DISCERN_METRIC alerts 5'",
      }),
    );
    await gitInit(dir);
    const r = await runAgent(dir, ["standards"]);
    assertEquals(r.code, 1, r.output);
    assertTerminalTextIncludes(r.stderr, "could not read 'per' metric 'words'");
  });
});
