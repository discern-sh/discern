/**
 * Engine tests for metric standards (ADR 0003).
 *
 * Every standard is a `[standards.<name>]` table with a direction (up=floor,
 * down=ceiling), a `limit`, and an inline `run` command that emits
 * `DISCERN_METRIC <name> <number>`. There is no built-in or special standard —
 * "coverage" is just a conventional name. `discern standards` runs them all.
 *
 * One `standards` run measures every configured table, so the comparison
 * matrix (floor, ceiling, equality, `per` rates, unreadable metrics, every
 * built-in extent) is configured into two fixtures — one that holds and one
 * that fails — and each verdict is asserted by name on the same run's human
 * and JSON surfaces. Boundary refusals (dirty tree, invalid config) and the
 * never-loosen comparison against the trunk pool onto those fixtures too.
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
import { targetExists } from "../src/shared/fs_presence.ts";
import { waitForPendingCondition } from "./waiting.ts";

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

/** The diagnostic one named standard produced, or a failure naming the run. */
function diagnosticFor(
  obj: StandardsJson,
  tool: string,
): NonNullable<StandardsJson["diagnostics"]>[number] {
  const diagnostic = (obj.diagnostics ?? []).find((d) => d.tool === tool);
  assert(diagnostic !== undefined, `no diagnostic for ${tool}`);
  return diagnostic;
}

/** The applied step one named standard produced. */
function stepFor(
  obj: StandardsJson,
  label: string,
): NonNullable<StandardsJson["steps"]>[number] {
  const step = (obj.steps ?? []).find((s) => s.label === label);
  assert(step !== undefined, `no step for ${label}`);
  return step;
}

/** One `[standards.<name>]` table whose inline `run` emits its metric. */
interface StandardSpec {
  name: string;
  metric?: string;
  direction: "up" | "down";
  limit: string;
  run: string;
  /** Raw TOML for `per`, e.g. `'{ words = "content/**" }'` or `'"words"'`. */
  per?: string;
  scale?: string;
  timeout?: string;
}

/** A config with the supplied `[standards.<name>]` tables, for either gate or
 * standalone execution. */
function standardsConfig(standards: readonly StandardSpec[]): string {
  const lines = [
    "[project]",
    'slug = "engine-test"',
    "",
    "[repository]",
    'trunk = "main"',
  ];
  for (const opts of standards) {
    lines.push(
      "",
      `[standards.${opts.name}]`,
      ...(opts.metric ? [`metric = "${opts.metric}"`] : []),
      `direction = "${opts.direction}"`,
      `limit = ${opts.limit}`,
      ...(opts.per ? [`per = ${opts.per}`] : []),
      ...(opts.scale ? [`scale = ${opts.scale}`] : []),
      ...(opts.timeout ? [`timeout = ${opts.timeout}`] : []),
      `run = "${opts.run}"`,
    );
  }
  lines.push("");
  return lines.join("\n");
}

/** A config with exactly one standard. */
function standardConfig(opts: StandardSpec): string {
  return standardsConfig([opts]);
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

/** Commit every working-tree change on the current branch. */
async function commitAll(dir: string, message: string): Promise<void> {
  await git(dir, "add", "-A");
  await git(dir, "commit", "-q", "-m", message, "--no-gpg-sign");
}

// ── Every built-in extent measures the right denominator (class guard) ─────────
// A fixture per built-in extent: a known corpus whose denominator the breakdown
// must report. Keyed by extent so the guard can assert it covers EXACTLY the
// EXTENTS SSOT — a new measure added to the vocabulary forces a case here rather
// than shipping with a silently-untested counter branch. Each run emits a 0
// numerator, so the rate is 0 regardless and only the measured denominator shows.
// Each extent owns its own corpus directory so every case measures in one run.
const EXTENT_CASES: Record<
  Extent,
  { files: Array<[string, string]>; per: string; expect: string }
> = {
  files: {
    files: [["extent-files/a.txt", "w"], ["extent-files/b.txt", "w"], [
      "extent-files/c.txt",
      "w",
    ]],
    per: '{ files = "extent-files/**" }',
    expect: "per 3 files",
  },
  lines: {
    files: [["extent-lines/x.txt", "a\nb\nc\nd\n"]], // 4 newlines
    per: '{ lines = "extent-lines/**" }',
    expect: "per 4 lines",
  },
  words: {
    files: [["extent-words/a.txt", Array(100).fill("w").join(" ")]], // 100 words
    per: '{ words = "extent-words/**" }',
    expect: "per 100 words",
  },
  bytes: {
    files: [["extent-bytes/x.txt", "abcdefghij"]], // 10 bytes
    per: '{ bytes = "extent-bytes/**" }',
    expect: "per 10 bytes",
  },
};

/** One holding rate standard per built-in extent, derived from the EXTENTS SSOT. */
function extentStandards(): StandardSpec[] {
  return EXTENTS.map((measure) => ({
    name: `extent_${measure}`,
    direction: "down",
    limit: "1",
    per: EXTENT_CASES[measure].per,
    run: `echo 'DISCERN_METRIC extent_${measure} 0'`,
  }));
}

// ── the holding matrix: every passing verdict in one measured run ──────────────

Deno.test("standards: every holding verdict, rate and extent measures in one run; a dirty tree refuses unless forced", async (t) => {
  await withTempDir(async (dir) => {
    await scaffoldEngine(dir); // default config: no [standards.<name>] tables
    await gitInit(dir);

    await t.step(
      "standards: a clean no-op when nothing is configured",
      async () => {
        const r = await runAgent(dir, ["standards"]);
        assertEquals(r.code, 0, r.output);
        assertTerminalTextIncludes(r.output, "No standards configured");
      },
    );

    // SSOT coupling: the cases name EXACTLY the EXTENTS vocabulary — a new extent
    // can't ship without a denominator case here, and a removed one can't leave a
    // dead case behind. This is the tie that auto-enrols the next measure.
    assertEquals(
      Object.keys(EXTENT_CASES).sort(),
      [...EXTENTS].sort(),
      "EXTENT_CASES must cover exactly the EXTENTS SSOT — add/remove a case for the changed extent",
    );
    await writeConfig(
      dir,
      standardsConfig([
        {
          name: "coverage",
          direction: "up",
          limit: "80",
          run: "echo 'DISCERN_METRIC coverage 85'",
        },
        {
          name: "equality",
          direction: "up",
          limit: "80",
          run: "echo 'DISCERN_METRIC equality 80'",
        },
        {
          name: "typecov",
          direction: "up",
          limit: "90",
          run: "echo 'DISCERN_METRIC typecov 95'",
        },
        {
          name: "bundle",
          metric: "bundle_bytes",
          direction: "down",
          limit: "100",
          run: "echo 'DISCERN_METRIC bundle_bytes 50'",
        },
        {
          name: "prose",
          direction: "down",
          limit: "12",
          per: '{ words = "content/**" }',
          scale: "1000",
          run: "echo 'DISCERN_METRIC prose 1'",
        },
        {
          name: "warnings",
          metric: "alerts",
          direction: "down",
          limit: "40",
          per: '"words"',
          scale: "1000",
          run:
            "echo 'DISCERN_METRIC alerts 30'; echo 'DISCERN_METRIC words 1000'",
        },
        {
          name: "rate",
          direction: "down",
          limit: "21", // ceiling on the RATE (per 1,000 words)
          per: '{ words = "rate-content/**" }',
          scale: "1000",
          run: "echo DISCERN_METRIC rate $(cat metric.txt)",
        },
        ...extentStandards(),
      ]),
    );
    await writeWordFile(dir, "content/a.txt", 100); // prose denominator = 100 words
    await Deno.writeTextFile(join(dir, "metric.txt"), "3\n");
    await writeWordFile(dir, "rate-content/a.txt", 150); // 3 / 150 * 1000 = 20.0
    for (const measure of EXTENTS) {
      for (const [rel, content] of EXTENT_CASES[measure].files) {
        await writeText(dir, rel, content);
      }
    }
    await commitAll(dir, "configure the holding matrix");

    const held = await runAgent(dir, ["standards"]);
    assertEquals(held.code, 0, held.output);

    await t.step(
      "standards: coverage passes when the emitted metric meets the floor",
      async () => {
        assertTerminalTextIncludes(held.stdout, "meets the floor");
        const proof = decodeWith(
          StandardMeasurementsSchema,
          await Deno.readTextFile(
            `${dir}/.git/${GIT_ADMIN_STATE.standardMeasurements.path}`,
          ),
        );
        // The recorded duration is the measurement group's whole-second wall
        // clock: instant alone, and a second or so alongside the extent counts.
        const duration = proof.durations?.coverage;
        assert(
          duration !== undefined && Number.isInteger(duration) &&
            duration >= 0,
          `the measurement proof must record coverage's duration: ${duration}`,
        );
      },
    );

    await t.step(
      "standards: an up-standard passes at equality with the floor",
      () => {
        assertTerminalTextIncludes(
          held.stdout,
          "equality 80 meets the floor 80",
        );
      },
    );

    await t.step("standards: an up-standard passes above its floor", () => {
      assertTerminalTextIncludes(held.stdout, "typecov 95 meets the floor 90");
    });

    await t.step("standards: a down-standard passes within its ceiling", () => {
      assertTerminalTextIncludes(held.stdout, "within the ceiling");
      assertTerminalTextIncludes(held.stdout, "standard(s) held");
    });

    await t.step(
      "standards: per a built-in word extent passes within the rate ceiling",
      () => {
        // 1 alert / 100 words * 1000 = 10 per 1,000 words, within the ceiling of 12.
        assertTerminalTextIncludes(
          held.stdout,
          "prose 10 within the ceiling 12",
        );
        assertTerminalTextIncludes(held.stdout, "per 100 words");
      },
    );

    await t.step(
      "standards: per a second emitted metric divides one number by the other",
      () => {
        // 30 alerts / 1000 words * 1000 = 30, within the ceiling of 40.
        assertTerminalTextIncludes(
          held.stdout,
          "alerts 30 within the ceiling 40",
        );
        assertTerminalTextIncludes(held.stdout, "per 1000");
      },
    );

    await t.step(
      "standards: EVERY built-in extent measures its own denominator",
      () => {
        for (const measure of EXTENTS) {
          assertStringIncludes(
            held.stdout,
            EXTENT_CASES[measure].expect,
            `the ${measure} extent must report "${
              EXTENT_CASES[measure].expect
            }" in the breakdown`,
          );
        }
      },
    );

    // Grow the rate corpus and its alerts proportionally: density stays 20.0, so
    // the SAME ceiling still holds — growth alone never breaches it. The growth
    // is uncommitted, so the next real run needs `--force`; the dirty-tree
    // refusals below stand on that same tree plus an untracked file.
    await writeWordFile(dir, "rate-content/a.txt", 300);
    await Deno.writeTextFile(join(dir, "metric.txt"), "6\n");
    await Deno.writeTextFile(`${dir}/dirty.txt`, "dirty\n");

    await t.step(
      "standards: non-dry-run refuses a dirty tree unless forced",
      async () => {
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
      },
    );

    const forced = await runAgent(dir, ["standards", "--force"]);
    assertEquals(forced.code, 0, forced.output);

    await t.step("standards: --force measures the dirty tree", () => {
      assertTerminalTextIncludes(forced.stdout, "meets the floor");
    });

    await t.step(
      "standards: a rate is invariant under proportional growth (the fix)",
      () => {
        assertTerminalTextIncludes(
          held.stdout,
          "rate 20 within the ceiling 21",
        );
        assertTerminalTextIncludes(
          forced.stdout,
          "rate 20 within the ceiling 21",
        );
      },
    );
  });
});

// ── the failing matrix: every failing verdict in one measured run ──────────────

Deno.test("standards: every failing verdict, unreadable metric and timeout is reported in one run on both surfaces", async (t) => {
  await withTempDir(async (dir) => {
    await scaffoldEngine(dir);
    // One standard holds so the aggregate proves every table ran; the rest fail
    // in a different way each.
    await writeConfig(
      dir,
      standardsConfig([
        {
          name: "coverage_ok",
          direction: "up",
          limit: "80",
          run: "echo 'DISCERN_METRIC coverage_ok 95'",
        },
        {
          name: "coverage",
          direction: "up",
          limit: "80",
          run: "echo 'DISCERN_METRIC coverage 70'",
        },
        {
          name: "bundle",
          metric: "bundle_bytes",
          direction: "down",
          limit: "100",
          run: "echo 'DISCERN_METRIC bundle_bytes 150'",
        },
        {
          // No DISCERN_METRIC line — only a trailing percentage. There is no
          // fallback any more, so the metric is unreadable and the standard errors.
          name: "trailing",
          direction: "up",
          limit: "80",
          run: "echo 'Total coverage: 90%'",
        },
        {
          name: "non_numeric_nan",
          direction: "up",
          limit: "80",
          run: "echo 'DISCERN_METRIC non_numeric_nan NaN'",
        },
        {
          name: "non_numeric_text",
          direction: "up",
          limit: "80",
          run: "echo 'DISCERN_METRIC non_numeric_text 12abc'",
        },
        {
          name: "prose",
          direction: "down",
          limit: "5",
          per: '{ words = "content/**" }',
          scale: "1000",
          run: "echo 'DISCERN_METRIC prose 1'",
        },
        {
          name: "nothing",
          direction: "down",
          limit: "5",
          per: '{ words = "nope/**" }',
          scale: "1000",
          run: "echo 'DISCERN_METRIC nothing 1'",
        },
        {
          name: "warnings",
          metric: "alerts",
          direction: "down",
          limit: "10",
          per: '"words"', // but the run emits no `words` metric
          scale: "1000",
          run: "echo 'DISCERN_METRIC alerts 5'",
        },
        {
          name: "slow",
          direction: "up",
          limit: "1",
          timeout: "1",
          run: "tail -f /dev/null; echo 'DISCERN_METRIC slow 1'",
        },
      ]),
    );
    await writeWordFile(dir, "content/a.txt", 100);
    await gitInit(dir);

    const r = await runAgent(dir, ["standards"]);
    assertEquals(r.code, 1, r.output);
    // The envelope carries every reason too: a caller that can't hear the live
    // narration (MCP, --json) must read the same words from diagnostics[], never
    // be left with a bare failed step.
    const json = await runAgent(dir, ["standards", "--json"]);
    assertEquals(json.code, 1, json.output);
    const obj = parseStandardsJson(json.stdout);
    assertEquals(obj.ok, false);

    await t.step(
      "standards: runs every configured standard, aggregating failures",
      () => {
        // coverage_ok held (reported) AND the others failed — all ran.
        assertTerminalTextIncludes(r.stdout, "meets the floor");
        assertTerminalTextIncludes(r.stderr, "exceeds the ceiling");
        assertTerminalTextIncludes(r.stderr, "standards failed");
      },
    );

    await t.step(
      "standards --json: a failing standard is a failed step and exit 1",
      () => {
        assertEquals(obj.steps?.map((s) => [s.label, s.outcome]), [
          ["coverage_ok", "ok"],
          ["coverage", "failed"],
          ["bundle", "failed"],
          ["trailing", "failed"],
          ["non_numeric_nan", "failed"],
          ["non_numeric_text", "failed"],
          ["prose", "failed"],
          ["nothing", "failed"],
          ["warnings", "failed"],
          ["slow", "failed"],
        ]);
      },
    );

    await t.step(
      "standards: coverage fails when the emitted metric is below the floor",
      () => {
        assertTerminalTextIncludes(r.stderr, "below the floor");
        const diag = diagnosticFor(obj, "coverage");
        assertStringIncludes(diag.message, "below the floor 80");
        // The reproduce is the standard's own measurement command, and the applied
        // step's note carries the measured value — no re-measurement needed to see
        // the number.
        assertStringIncludes(diag.reproduce_cmd, "DISCERN_METRIC coverage 70");
        assertStringIncludes(
          stepFor(obj, "coverage").note ?? "",
          "measured 70",
        );
      },
    );

    await t.step("standards: a down-standard fails above its ceiling", () => {
      assertTerminalTextIncludes(
        r.stderr,
        "bundle_bytes 150 exceeds the ceiling 100",
      );
      assertEquals(stepFor(obj, "bundle").outcome, "failed");
    });

    await t.step(
      "standards: a trailing NN% is NOT read — only the DISCERN_METRIC marker counts",
      () => {
        assertTerminalTextIncludes(r.stderr, "could not read metric");
        // A metric-reading failure's evidence is the measurement output itself — the
        // diagnostic carries it so a remote caller can see what the command emitted.
        const diag = diagnosticFor(obj, "trailing");
        assertStringIncludes(diag.message, "could not read metric");
        assertTerminalTextIncludes(diag.output ?? "", "Total coverage: 90%");
      },
    );

    await t.step(
      "standards: non-numeric emitted metrics fail before comparison",
      () => {
        assertTerminalTextIncludes(r.stderr, "is not a number");
        for (const value of ["NaN", "12abc"]) {
          assertStringIncludes(r.stderr, value);
        }
      },
    );

    await t.step(
      "standards: per a built-in word extent fails when the rate exceeds the ceiling",
      () => {
        // 10 per 1,000 words exceeds the ceiling of 5.
        assertTerminalTextIncludes(r.stderr, "prose 10 exceeds the ceiling 5");
        assertTerminalTextIncludes(r.stderr, "per 100 words");
      },
    );

    await t.step(
      "standards: a `per` extent matching nothing errors instead of dividing by zero",
      () => {
        assertTerminalTextIncludes(r.stderr, "nothing to divide by");
        assertStringIncludes(
          diagnosticFor(obj, "nothing").message,
          "nothing to divide by",
        );
      },
    );

    await t.step(
      "standards: a `per` metric the run never emits errors clearly",
      () => {
        assertTerminalTextIncludes(
          r.stderr,
          "could not read 'per' metric 'words'",
        );
      },
    );

    await t.step(
      "standards: a per-standard timeout bounds the standalone measurement",
      () => {
        assert(obj.data !== undefined && "standards" in obj.data, json.output);
        const diagnostic = diagnosticFor(obj, "slow");
        assertStringIncludes(diagnostic.message, "timed out after 1s");
        // A timeout-killed Standard self-identifies as a timeout: the message
        // binds the fired budget to the Standard's own config key, and `rule`
        // marks the class for every downstream reduction of the diagnostic.
        assertStringIncludes(
          diagnostic.message,
          "the budget comes from `[standards.slow].timeout`",
        );
        assertEquals(diagnostic.rule, "timeout");
        assertStringIncludes(diagnostic.reproduce_cmd, "tail -f /dev/null");
        const measured = obj.data.standards?.find((standard) =>
          standard.name === "slow"
        );
        assert(measured !== undefined, json.output);
        assert(
          typeof measured.duration_s === "number" &&
            Number.isFinite(measured.duration_s) && measured.duration_s >= 0,
          "the standard reports an observed producer duration, independently of its configured budget",
        );
        assertEquals(stepFor(obj, "slow").duration_s, measured.duration_s);
      },
    );
  });
});

Deno.test("standardsResult: cancellation starts no work and stops in-flight work", async () => {
  await withTempDir(async (dir) => {
    await scaffoldEngine(dir);
    await writeConfig(
      dir,
      standardConfig({
        name: "slow",
        direction: "up",
        limit: "1",
        run:
          "touch .git/standard-cancel-ready; tail -f /dev/null; touch .git/standard-cancel-finished; echo 'DISCERN_METRIC slow 1'",
      }),
    );
    await gitInit(dir);
    const ready = join(dir, ".git/standard-cancel-ready");
    const finished = join(dir, ".git/standard-cancel-finished");

    for (const timing of ["pre-aborted", "mid-run"] as const) {
      const controller = new AbortController();
      if (timing === "pre-aborted") {
        controller.abort();
      }
      const pending = standardsResult(dir, { signal: controller.signal });
      if (timing === "mid-run") {
        await waitForPendingCondition(
          pending,
          async () => await targetExists(ready),
          "the Standard measurement to start before cancellation",
        );
        controller.abort();
      }
      const result = await pending;

      assertEquals(result.ok, false, `${timing}: ${JSON.stringify(result)}`);
      assertEquals(await targetExists(finished), false, timing);
      if (timing === "pre-aborted") {
        assertEquals(await targetExists(ready), false);
        assertStringIncludes(
          result.message ?? "",
          "cancelled before it started",
        );
      }
    }
  });
});

// ── never loosen: every limit is compared with the trunk's committed copy ──────

Deno.test("standards: a limit may only tighten vs main — loosening, deleting and raising fail; tightening passes; a raw count breaks under growth", async (t) => {
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

    await t.step(
      "standards: a down-standard ceiling may not be raised vs main",
      async () => {
        await git(dir, "checkout", "-q", "-b", "agent/raise");
        await writeConfig(
          dir,
          standardConfig({
            name: "bundle",
            direction: "down",
            limit: "150",
            run: "echo 'DISCERN_METRIC bundle 50'",
          }),
        );
        await commitAll(dir, "raise the ceiling");

        const r = await runAgent(dir, ["standards"]);
        assertEquals(r.code, 1, r.output);
        assertTerminalTextIncludes(r.stderr, "only falls");
        await git(dir, "checkout", "-q", "main");
      },
    );

    // The trunk moves on to hold one floor; the branch cases below compare
    // against THIS committed copy.
    await writeConfig(
      dir,
      standardConfig({
        name: "coverage",
        direction: "up",
        limit: "80",
        run: "echo 'DISCERN_METRIC coverage 99'",
      }),
    );
    await commitAll(dir, "hold a coverage floor on main");

    await t.step("standards: a limit may not be lowered vs main", async () => {
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
      await commitAll(dir, "lower the floor");

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
      await git(dir, "checkout", "-q", "main");
    });

    await t.step(
      "standards: a standard deleted from branch config is reported",
      async () => {
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
        await commitAll(dir, "delete the standard");

        const run = await runAgent(dir, ["standards", "--json"]);
        assertEquals(run.code, 1, run.output);
        const result = parseStandardsJson(run.stdout);
        const diagnostic = (result.diagnostics ?? [])[0];
        assertEquals(diagnostic?.tool, "coverage", run.stdout);
        assertStringIncludes(
          diagnostic?.message ?? "",
          "deleted on this branch",
        );
        assertEquals(
          result.steps?.map((step) => [step.label, step.outcome]),
          [["coverage", "failed"]],
        );
        await git(dir, "checkout", "-q", "main");
      },
    );

    // Main now holds a floor and a ceiling; a branch tightens both at once.
    await writeConfig(
      dir,
      standardsConfig([
        {
          name: "coverage",
          direction: "up",
          limit: "80",
          run: "echo 'DISCERN_METRIC coverage 95'",
        },
        {
          name: "bundle",
          direction: "down",
          limit: "100",
          run: "echo 'DISCERN_METRIC bundle 80'",
        },
      ]),
    );
    await commitAll(dir, "hold a floor and a ceiling on main");
    await git(dir, "checkout", "-q", "-b", "agent/tighten");
    await writeConfig(
      dir,
      standardsConfig([
        {
          name: "coverage",
          direction: "up",
          limit: "90",
          run: "echo 'DISCERN_METRIC coverage 95'",
        },
        {
          name: "bundle",
          direction: "down",
          limit: "90",
          run: "echo 'DISCERN_METRIC bundle 80'",
        },
        {
          // A raw-count ceiling at the small count (3), no `per` — new on the
          // branch, so it passes vacuously against main.
          name: "prose",
          direction: "down",
          limit: "3",
          run: "echo DISCERN_METRIC prose $(cat metric.txt)",
        },
      ]),
    );
    await Deno.writeTextFile(join(dir, "metric.txt"), "3\n");
    await commitAll(dir, "tighten coverage and bundle");

    const small = await runAgent(dir, ["standards"]);
    assertEquals(small.code, 0, small.output); // prose: 3 within the ceiling of 3

    await t.step(
      "standards: tightening the limit vs main passes in both directions",
      () => {
        assertTerminalTextIncludes(small.stdout, "meets the floor");
        assertTerminalTextIncludes(small.stdout, "within the ceiling");
      },
    );

    await t.step(
      "standards: the same growth breaks a raw count, and the failure points at `per`",
      async () => {
        // The same proportional growth as the rate test — but a raw count rises
        // with size and breaches the ceiling, the exact trap `per` removes.
        await Deno.writeTextFile(join(dir, "metric.txt"), "6\n");
        const grown = await runAgent(dir, ["standards", "--force"]);
        assertEquals(grown.code, 1, grown.output);
        assertTerminalTextIncludes(grown.stderr, "exceeds the ceiling");
        assertTerminalTextIncludes(grown.stderr, "hold a rate"); // the normalize hint
      },
    );
  });
});

// ── config errors are caught at load, before anything measures ─────────────────

Deno.test("standards: an invalid standard table is refused at load with a path-qualified message", async (t) => {
  await withTempDir(async (dir) => {
    await scaffoldEngine(dir);
    await gitInit(dir);

    await t.step(
      "standards: a misconfigured standard (no run command) errors clearly",
      async () => {
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
        const r = await runAgent(dir, ["standards"]);
        assertEquals(r.code, 1, r.output);
        assertTerminalTextIncludes(r.stderr, "discern.toml is invalid");
        assertStringIncludes(r.stderr, "standards.coverage.producer");
      },
    );

    await t.step(
      "standards: an empty `per` pathspec is refused at load, never measuring the whole repo (B42)",
      async () => {
        // The end-to-end half of the B42 guard. With `per = { words = [] }`, git's
        // `ls-files --` (no pathspecs) would list EVERY tracked file, making the
        // denominator the whole repo — a wildly wrong, silently-passing rate. The
        // schema now refuses the empty array at load, so `standards` errors with a
        // path-qualified config message and measures nothing at all.
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
        const r = await runAgent(dir, ["standards"]);
        assertEquals(r.code, 1, r.output);
        assertTerminalTextIncludes(r.stderr, "discern.toml is invalid");
        assertStringIncludes(r.stderr, "standards.prose.per.words");
        // It must NOT have run a whole-repo measurement — no metric narration leaks.
        assert(!r.stdout.includes("per"), r.output);
      },
    );
  });
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
    },
    metric: "coverage",
    direction: "up",
    limit: 80,
    command: "echo 'DISCERN_METRIC coverage 80'",
    limitKey: "standards.coverage.limit",
    scale: 1,
    margin: 0,
  };
  const failure = standardPlanIntegrityFailure({ standards: [standard] }, []);
  assert(failure !== undefined, "a mismatch must produce a failed step");
  assertEquals(failure.outcome, "failed");
  assertEquals(failure.step.label, "plan-integrity");
  assertStringIncludes(failure.step.note ?? "", "planned 1 standard(s)");
  assertStringIncludes(failure.step.note ?? "", "projected 0 step(s)");
});
