/**
 * Engine tests for standards IN the gate (ADR 0133) — the two tiers that make
 * "never lower your standards" structure rather than advice:
 *
 *  - **Tier 1** (always): every `[standards]` limit verified against the
 *    trunk's committed copy on every real `done` run — loosened or deleted
 *    fails the gate; an unreadable trunk skips loudly; a trunk config that was
 *    fetched but does not parse fails hard.
 *  - **Tier 2** (default): each standard measured as a job inside the parallel
 *    check∥test group — a regressed metric fails the gate; `measure =
 *    "on-demand"` defers only the measurement; a standard whose declared
 *    `inputs` are untouched since the last recorded measurement REPLAYS that
 *    value instead of re-measuring (rename-safety included — the class that
 *    has bitten before).
 *
 * The zero-cost contract is pinned structurally: with `[standards]` empty, the
 * gate plan is byte-identical to a standards-free gate.
 */

import { assert, assertEquals, assertStringIncludes } from "@std/assert";
import { join } from "@std/path";
import { withTempDir } from "./helpers.ts";
import {
  git,
  gitInit,
  runAgent,
  scaffoldEngine,
  writeConfig,
} from "./engine_helpers.ts";
import { buildGatePlan } from "../src/engine/gate/plan.ts";
import { buildStandardPlan } from "../src/engine/gate/standard_plan.ts";
import { planStandardJobsFromConfig } from "../src/engine/gate/standards_gate.ts";
import { parseConfigOrThrow } from "../src/shared/config_schema.ts";

interface JsonStep {
  kind: string;
  label: string;
  disposition: string;
  outcome: string;
  note?: string;
  group?: string;
  duration_s?: number;
}

interface JsonDiagnostic {
  tool: string;
  message: string;
  reproduce_cmd: string;
}

interface GateJson {
  ok: boolean;
  verb: string;
  steps?: JsonStep[];
  diagnostics?: JsonDiagnostic[];
  hints?: string[];
  data?: {
    failed_stage: string | null;
    standards?: Array<{
      name: string;
      direction: string;
      limit: number;
      measurement: string;
      value?: number;
      verdict?: string;
      duration_s?: number;
      replayed_from?: string;
    }>;
    standards_limits?: { status: string; trunk: string; reason?: string };
    receipt?: { markdown: string };
  };
}

function parseGateJson(stdout: string): GateJson {
  const obj = JSON.parse(stdout.trim()) as GateJson;
  assertEquals(obj.verb, "done");
  return obj;
}

/** A minimal gate config with one standard, parameterized for each tier's
 * scenarios. `extra` lines land inside the [standards.cov] table. */
function covConfig(opts: {
  limit: number;
  run?: string;
  extra?: string[];
}): string {
  return [
    "[project]",
    'slug = "engine-test"',
    'main_branch = "main"',
    "",
    "[capabilities]",
    'lint = "true"',
    "",
    "[standards.cov]",
    'direction = "up"',
    `limit = ${opts.limit}`,
    `run = "${opts.run ?? "echo DISCERN_METRIC cov 90"}"`,
    ...(opts.extra ?? []),
    "",
  ].join("\n");
}

// ── Tier 1: the never-loosen verification ────────────────────────────────────

Deno.test("tier 1: a loosened limit fails the gate, naming the standard and both values", async () => {
  await withTempDir(async (dir) => {
    await scaffoldEngine(dir);
    await writeConfig(dir, covConfig({ limit: 80 }));
    await gitInit(dir); // trunk copy: floor 80
    // Loosen the floor in the working tree — the quiet edit Tier 1 exists to catch.
    await writeConfig(dir, covConfig({ limit: 70 }));

    const r = await runAgent(dir, ["done", "--json"]);
    assertEquals(r.code, 1, r.output);
    const obj = parseGateJson(r.stdout);
    assertEquals(obj.data?.failed_stage, "standards");
    assertEquals(obj.data?.standards_limits?.status, "loosened");
    const diag = (obj.diagnostics ?? []).find((d) => d.tool === "standard:cov");
    assert(diag !== undefined, r.stdout);
    assertStringIncludes(diag.message, "80"); // the trunk's value
    assertStringIncludes(diag.message, "70"); // the branch's value
    assertStringIncludes(diag.message, "owner decision taken on the trunk");
  });
});

Deno.test("tier 1: a deleted standard is the ultimate loosening and fails the gate", async () => {
  await withTempDir(async (dir) => {
    await scaffoldEngine(dir);
    await writeConfig(dir, covConfig({ limit: 80 }));
    await gitInit(dir);
    // Delete the whole [standards.cov] table in the working tree.
    await writeConfig(
      dir,
      [
        "[project]",
        'slug = "engine-test"',
        'main_branch = "main"',
        "",
        "[capabilities]",
        'lint = "true"',
        "",
      ].join("\n"),
    );

    const r = await runAgent(dir, ["done", "--json"]);
    assertEquals(r.code, 1, r.output);
    const obj = parseGateJson(r.stdout);
    assertEquals(obj.data?.failed_stage, "standards");
    const diag = (obj.diagnostics ?? []).find((d) => d.tool === "standard:cov");
    assert(diag !== undefined, r.stdout);
    assertStringIncludes(diag.message, "deleted on this branch");
    assertStringIncludes(diag.message, "80");
  });
});

Deno.test("tier 1: a standard new on the branch passes vacuously; a tightened limit passes", async () => {
  await withTempDir(async (dir) => {
    await scaffoldEngine(dir);
    await writeConfig(dir, covConfig({ limit: 80 }));
    await gitInit(dir);
    // Tighten the existing floor AND add a brand-new standard: both legal.
    await writeConfig(
      dir,
      covConfig({ limit: 85 }) + [
        "[standards.fresh]",
        'direction = "down"',
        "limit = 5",
        'run = "echo DISCERN_METRIC fresh 1"',
        "",
      ].join("\n"),
    );

    const r = await runAgent(dir, ["done", "--json"]);
    assertEquals(r.code, 0, r.output);
    const obj = parseGateJson(r.stdout);
    assertEquals(obj.data?.standards_limits?.status, "verified");
  });
});

Deno.test("tier 1: an unreadable trunk skips LOUDLY — the gate passes with the unverified disclosure and the fetch hint", async () => {
  await withTempDir(async (dir) => {
    await scaffoldEngine(dir);
    await writeConfig(dir, covConfig({ limit: 80 }));
    await gitInit(dir);
    // Simulate the unfetched-trunk CI clone: the configured trunk name has no ref.
    await git(dir, "branch", "-M", "trunk-elsewhere");

    const r = await runAgent(dir, ["done", "--json"]);
    assertEquals(r.code, 0, r.output);
    const obj = parseGateJson(r.stdout);
    assertEquals(obj.data?.standards_limits?.status, "unverified");
    const hint = (obj.hints ?? []).find((h) => h.includes("UNVERIFIED"));
    assert(hint !== undefined, `expected the loud disclosure: ${r.stdout}`);
    assertStringIncludes(hint, "git fetch");
  });
});

Deno.test("tier 1: a trunk config that was fetched but does not parse fails hard", async () => {
  await withTempDir(async (dir) => {
    await scaffoldEngine(dir);
    await writeConfig(dir, covConfig({ limit: 80 }));
    await gitInit(dir);
    // Commit a BROKEN config on the trunk, then repair only the working tree:
    // the loaded config is fine, the baseline is not.
    await Deno.writeTextFile(join(dir, "discern.toml"), "[standards\nbroken");
    await git(dir, "commit", "-aqm", "break the trunk config", "--no-gpg-sign");
    await writeConfig(dir, covConfig({ limit: 80 }));

    const r = await runAgent(dir, ["done", "--json"]);
    assertEquals(r.code, 1, r.output);
    const obj = parseGateJson(r.stdout);
    assertEquals(obj.data?.failed_stage, "standards");
    assertEquals(obj.data?.standards_limits?.status, "parse_failed");
    const diag = (obj.diagnostics ?? []).find((d) => d.tool === "standards");
    assert(diag !== undefined, r.stdout);
    assertStringIncludes(diag.message, "does not parse");
  });
});

// ── Tier 2: measurement inside the parallel group ─────────────────────────────

Deno.test("tier 2: a holding standard is measured inside the check/test group, value and duration in the envelope", async () => {
  await withTempDir(async (dir) => {
    await scaffoldEngine(dir);
    await writeConfig(dir, covConfig({ limit: 80 }));
    await gitInit(dir);

    const r = await runAgent(dir, ["done", "--json"]);
    assertEquals(r.code, 0, r.output);
    const obj = parseGateJson(r.stdout);
    const step = (obj.steps ?? []).find((s) => s.label === "standard:cov");
    assert(step !== undefined, r.stdout);
    assertEquals(step.kind, "standard");
    assertEquals(step.outcome, "ok");
    // Genuinely inside the parallel group — same group as the checks/tests.
    assertEquals(step.group, "Check & test");
    assertStringIncludes(step.note ?? "", "measured 90");
    const entry = obj.data?.standards?.find((s) => s.name === "cov");
    assertEquals(entry?.measurement, "measured");
    assertEquals(entry?.value, 90);
    assertEquals(entry?.verdict, "improved");
    assert(
      typeof entry?.duration_s === "number",
      `expected a recorded duration: ${JSON.stringify(entry)}`,
    );
  });
});

Deno.test("tier 2: a regressed metric fails the gate with the standard diagnostics contract", async () => {
  await withTempDir(async (dir) => {
    await scaffoldEngine(dir);
    await writeConfig(
      dir,
      covConfig({ limit: 80, run: "echo DISCERN_METRIC cov 60" }),
    );
    await gitInit(dir);

    const r = await runAgent(dir, ["done", "--json"]);
    assertEquals(r.code, 1, r.output);
    const obj = parseGateJson(r.stdout);
    assertEquals(obj.data?.failed_stage, "check/test");
    const diag = (obj.diagnostics ?? []).find((d) => d.tool === "standard:cov");
    assert(diag !== undefined, r.stdout);
    assertStringIncludes(diag.message, "60"); // measured
    assertStringIncludes(diag.message, "below the floor 80"); // limit + direction
    assertEquals(diag.reproduce_cmd, "echo DISCERN_METRIC cov 60");
    const entry = obj.data?.standards?.find((s) => s.name === "cov");
    assertEquals(entry?.verdict, "regressed");
  });
});

Deno.test("tier 2: a measurement's exit code is not its verdict — the metric line decides", async () => {
  await withTempDir(async (dir) => {
    await scaffoldEngine(dir);
    await writeConfig(
      dir,
      covConfig({ limit: 80, run: "echo DISCERN_METRIC cov 90; exit 3" }),
    );
    await gitInit(dir);

    const r = await runAgent(dir, ["done", "--json"]);
    assertEquals(r.code, 0, r.output);
    const obj = parseGateJson(r.stdout);
    const step = (obj.steps ?? []).find((s) => s.label === "standard:cov");
    assertEquals(step?.outcome, "ok", r.stdout);
  });
});

Deno.test('tier 2: measure = "on-demand" defers the measurement but never the limit check, and the hints name it', async () => {
  await withTempDir(async (dir) => {
    await scaffoldEngine(dir);
    const deferred = (limit: number): string =>
      covConfig({
        limit,
        run: "echo should-not-run > measured.flag",
        extra: ['measure = "on-demand"'],
      });
    await writeConfig(dir, deferred(80));
    await gitInit(dir);

    // Deferred: green gate, no measurement side-effect, the deferral named.
    const green = await runAgent(dir, ["done", "--json"]);
    assertEquals(green.code, 0, green.output);
    const obj = parseGateJson(green.stdout);
    const entry = obj.data?.standards?.find((s) => s.name === "cov");
    assertEquals(entry?.measurement, "deferred");
    const flag = await Deno.stat(join(dir, "measured.flag")).catch(() => null);
    assertEquals(flag, null, "a deferred standard must not run its command");
    const hint = (obj.hints ?? []).find((h) => h.includes("deferred"));
    assert(hint !== undefined, green.stdout);
    assertStringIncludes(hint, "cov");
    assertStringIncludes(hint, "discern standards");

    // Tier 1 still covers it: loosening the deferred standard's limit fails.
    await writeConfig(dir, deferred(70));
    const red = await runAgent(dir, ["done", "--json"]);
    assertEquals(red.code, 1, red.output);
    assertEquals(parseGateJson(red.stdout).data?.failed_stage, "standards");
  });
});

Deno.test("tier 2: hint variants — no standards configured means no standards hint and no envelope fields", async () => {
  await withTempDir(async (dir) => {
    await scaffoldEngine(dir);
    await writeConfig(
      dir,
      [
        "[project]",
        'slug = "engine-test"',
        'main_branch = "main"',
        "",
        "[capabilities]",
        'lint = "true"',
        "",
      ].join("\n"),
    );
    await gitInit(dir);

    const r = await runAgent(dir, ["done", "--json"]);
    assertEquals(r.code, 0, r.output);
    const obj = parseGateJson(r.stdout);
    assertEquals(obj.data?.standards, undefined);
    assertEquals(obj.data?.standards_limits, undefined);
    const hint = (obj.hints ?? []).find((h) =>
      h.includes("standard") || h.includes("standards")
    );
    assertEquals(hint, undefined, r.stdout);
  });
});

Deno.test("tier 2: the dry-run plan lists the standards inside the check/test group", async () => {
  await withTempDir(async (dir) => {
    await scaffoldEngine(dir);
    await writeConfig(
      dir,
      covConfig({ limit: 80 }) + [
        "[standards.slow]",
        'direction = "down"',
        "limit = 5",
        'run = "echo DISCERN_METRIC slow 1"',
        'measure = "on-demand"',
        "",
      ].join("\n"),
    );
    await gitInit(dir);

    const r = await runAgent(dir, ["done", "--dry-run", "--json"]);
    assertEquals(r.code, 0, r.output);
    const obj = JSON.parse(r.stdout.trim()) as {
      plan?: { steps: JsonStep[] };
    };
    const cov = obj.plan?.steps.find((s) => s.label === "standard:cov");
    assertEquals(cov?.disposition, "run");
    assertEquals(cov?.group, "Check & test");
    const slow = obj.plan?.steps.find((s) => s.label === "standard:slow");
    assertEquals(slow?.disposition, "skip");
    assertStringIncludes(slow?.note ?? "", "on-demand");
  });
});

// ── the measurement receipt: a green gate records it; --pin replays it ───────

Deno.test("a green gate over a clean committed tree records the measurement receipt, and `standards --pin` replays it without re-measuring", async () => {
  await withTempDir(async (dir) => {
    await scaffoldEngine(dir);
    // The measurement appends to a counter file, so the test can prove pin
    // re-used the gate's values instead of measuring a second time.
    await writeConfig(
      dir,
      covConfig({
        limit: 80,
        run: "echo x >> runs.count; echo DISCERN_METRIC cov 90",
      }),
    );
    await gitInit(dir);
    // `runs.count` must not dirty the tree after the gate runs the measurement.
    await Deno.writeTextFile(join(dir, ".gitignore"), "runs.count\n");
    await git(dir, "add", ".gitignore");
    await git(dir, "commit", "-qm", "ignore the counter", "--no-gpg-sign");

    const green = await runAgent(dir, ["done", "--json"]);
    assertEquals(green.code, 0, green.output);
    const runsAfterGate =
      (await Deno.readTextFile(join(dir, "runs.count"))).trim().split("\n")
        .length;
    assertEquals(runsAfterGate, 1);

    const pin = await runAgent(dir, ["standards", "--pin", "--json"]);
    assertEquals(pin.code, 0, pin.output);
    const pinObj = JSON.parse(pin.stdout.trim()) as { hints?: string[] };
    const reused = (pinObj.hints ?? []).find((h) => h.includes("Reused"));
    assert(
      reused !== undefined,
      `expected the pin to reuse the gate's measurements: ${pin.stdout}`,
    );
    // No second measurement ran.
    const runsAfterPin =
      (await Deno.readTextFile(join(dir, "runs.count"))).trim().split("\n")
        .length;
    assertEquals(runsAfterPin, 1, "pin must not re-measure after a green gate");
    // And the pin captured the gain: the floor tightened to the measured value.
    const config = await Deno.readTextFile(join(dir, "discern.toml"));
    assertStringIncludes(config, "limit = 90");
  });
});

// ── the zero-cost contract (structural) ───────────────────────────────────────

Deno.test("zero cost when [standards] is empty: the gate plan is byte-identical to a standards-free gate", () => {
  const cfg = parseConfigOrThrow(
    [
      "[capabilities]",
      'lint = "true"',
      'test = "true"',
      "",
      "[scopes.web]",
      'paths = ["web/**"]',
      'gate = "true"',
    ].join("\n"),
  );
  const plan = buildStandardPlan(cfg);
  assertEquals(plan.standards.length, 0);
  const withStandards = buildGatePlan(
    cfg,
    ["web"],
    planStandardJobsFromConfig(plan.standards),
  );
  const without = buildGatePlan(cfg, ["web"]);
  assertEquals(withStandards, without);
});

// ── the receipt's standards section ───────────────────────────────────────────

Deno.test("the receipt renders the standards section and the limits-verified line", async () => {
  await withTempDir(async (dir) => {
    await scaffoldEngine(dir);
    await writeConfig(dir, covConfig({ limit: 80 }));
    await gitInit(dir);
    // A committed branch ahead of the trunk, so a receipt is rendered.
    await git(dir, "checkout", "-qb", "agent/std-receipt");
    await Deno.writeTextFile(join(dir, "work.txt"), "w\n");
    await git(dir, "add", "work.txt");
    await git(dir, "commit", "-qm", "work", "--no-gpg-sign");

    const r = await runAgent(dir, ["done", "--json"]);
    assertEquals(r.code, 0, r.output);
    const obj = parseGateJson(r.stdout);
    const markdown = obj.data?.receipt?.markdown ?? "";
    assertStringIncludes(markdown, "Standards (limits verified against");
    assertStringIncludes(markdown, "cov 90 (floor 80, improved)");
  });
});

// ── prepare stays measurement-free ────────────────────────────────────────────

Deno.test("prepare never measures a standard", async () => {
  await withTempDir(async (dir) => {
    await scaffoldEngine(dir);
    await writeConfig(
      dir,
      covConfig({
        limit: 80,
        run: "echo x >> prepared.flag; echo DISCERN_METRIC cov 90",
      }),
    );
    await gitInit(dir);

    const r = await runAgent(dir, ["prepare", "--json"]);
    assertEquals(r.code, 0, r.output);
    const flag = await Deno.stat(join(dir, "prepared.flag")).catch(() => null);
    assertEquals(flag, null, "prepare must not run a standard's measurement");
    const obj = JSON.parse(r.stdout.trim()) as { steps?: JsonStep[] };
    const step = (obj.steps ?? []).find((s) => s.label.startsWith("standard:"));
    assertEquals(step, undefined, r.stdout);
  });
});
