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
 *
 * Guards: boundary:non-loosening-standards, claim:standards-cannot-loosen
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
import { HINTS } from "../src/shared/hints.ts";
import { assertHasHint } from "./hint_asserts.ts";
import { targetExists } from "../src/shared/fs_presence.ts";
import type { GateWireData } from "../src/shared/result_schemas.ts";
import {
  type CliResultForCommand,
  decodeCliResult,
} from "./decode_cli_result.ts";

type GateJson = Omit<CliResultForCommand<"done">, "data"> & {
  data: GateWireData | undefined;
};

/** Decode a gate envelope and assert the fixture actually exercised the done verb. */
function parseGateJson(stdout: string): GateJson {
  const obj = decodeCliResult(stdout, "done");
  assertEquals(obj.verb, "done");
  assert(
    obj.data === undefined || "failed_stage" in obj.data,
    "done must return gate data rather than config-issue data",
  );
  return { ...obj, data: obj.data };
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
    "",
    "[repository]",
    'trunk = "main"',
    "",
    "[jobs]",
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
    assertStringIncludes(diag.message, "discern standards propose");
    assertStringIncludes(diag.message, "exact owner approval");
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
        "",
        "[repository]",
        'trunk = "main"',
        "",
        "[jobs]",
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

Deno.test("tier 1: an unreadable local trunk fails closed with the disclosure and recovery hint", async () => {
  await withTempDir(async (dir) => {
    await scaffoldEngine(dir);
    await writeConfig(dir, covConfig({ limit: 80 }));
    await gitInit(dir);
    // Simulate the unfetched-trunk CI clone: the configured trunk name has no ref.
    await git(dir, "branch", "-M", "trunk-elsewhere");

    const r = await runAgent(dir, ["done", "--json"]);
    assertEquals(r.code, 1, r.output);
    const obj = parseGateJson(r.stdout);
    assertEquals(obj.data?.failed_stage, "standards");
    assertEquals(obj.data?.standards_limits?.status, "unverified");
    const reason = obj.data?.standards_limits?.reason;
    assert(reason !== undefined, `expected the unverified reason: ${r.stdout}`);
    assertHasHint(obj, HINTS["gate-standards-limits-unverified"], {
      reason,
      trunk: "main",
    });
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
    await writeConfig(
      dir,
      covConfig({ limit: 80, extra: ["margin = 5"] }),
    );
    await gitInit(dir);

    const r = await runAgent(dir, ["done", "--json"]);
    assertEquals(r.code, 0, r.output);
    const obj = parseGateJson(r.stdout);
    const step = (obj.steps ?? []).find((s) => s.label === "standard:cov");
    assert(step !== undefined, r.stdout);
    assertEquals(step.kind, "standard");
    assertEquals(step.outcome, "ok");
    // Genuinely inside the parallel group — same group as the checks/tests.
    assertEquals(step.group, "Test & standards");
    assertStringIncludes(step.note ?? "", "measured 90");
    const entry = obj.data?.standards?.find((s) => s.name === "cov");
    assertEquals(entry?.measurement, "measured");
    assertEquals(entry?.value, 90);
    assertEquals(entry?.verdict, "improved");
    assertEquals(entry?.margin, 5);
    assertEquals(entry?.pin_eligible, true);
    assertEquals(entry?.pin_target, 85);
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
    assertEquals(obj.data?.failed_stage, "test");
    const diag = (obj.diagnostics ?? []).find((d) => d.tool === "standard:cov");
    assert(diag !== undefined, r.stdout);
    assertStringIncludes(diag.message, "60"); // measured
    assertStringIncludes(diag.message, "below the floor 80"); // limit + direction
    assertEquals(diag.reproduce_cmd, "echo DISCERN_METRIC cov 60");
    const entry = obj.data?.standards?.find((s) => s.name === "cov");
    assertEquals(entry?.verdict, "regressed");
  });
});

Deno.test("tier 2: a failed producer cannot supply passing standard evidence", async () => {
  await withTempDir(async (dir) => {
    await scaffoldEngine(dir);
    await writeConfig(
      dir,
      covConfig({ limit: 80, run: "echo DISCERN_METRIC cov 90; exit 3" }),
    );
    await gitInit(dir);

    const r = await runAgent(dir, ["done", "--json"]);
    assertEquals(r.code, 1, r.output);
    const obj = parseGateJson(r.stdout);
    const step = (obj.steps ?? []).find((s) => s.label === "standard:cov");
    assertEquals(step?.outcome, "failed", r.stdout);
    assertEquals(obj.data?.gate_proof?.status, "unavailable");
  });
});

Deno.test("tier 2: measurement deferrals are concretely refused before a producer starts", async () => {
  await withTempDir(async (dir) => {
    await scaffoldEngine(dir);
    await writeConfig(
      dir,
      covConfig({
        limit: 80,
        run: "echo should-not-run > measured.flag",
        extra: ['measure = "on-demand"'],
      }),
    );
    await gitInit(dir);
    const refusal = await runAgent(dir, ["done", "--json"]);
    assertEquals(refusal.code, 1, refusal.output);
    assertStringIncludes(refusal.output, "measure");
    assertEquals(await targetExists(join(dir, "measured.flag")), false);
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
        "",
        "[repository]",
        'trunk = "main"',
        "",
        "[jobs]",
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
        "",
      ].join("\n"),
    );
    await gitInit(dir);

    const r = await runAgent(dir, ["done", "--dry-run", "--json"]);
    assertEquals(r.code, 0, r.output);
    const obj = decodeCliResult(r.stdout, "done");
    const cov = obj.plan?.steps.find((s) => s.label === "standard:cov");
    assertEquals(cov?.disposition, "run");
    assertEquals(cov?.group, "Test & standards");
    const slow = obj.plan?.steps.find((s) => s.label === "standard:slow");
    assertEquals(slow?.disposition, "run");
  });
});

// ── the measurement proof: a green gate records it; --pin replays it ───────

Deno.test("a green gate over a clean committed tree records the measurement proof, and `standards --pin` replays it without re-measuring", async () => {
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
    const pinObj = decodeCliResult(pin.stdout, "standards");
    assertHasHint(pinObj, HINTS["standards-pin-reused-measurements"]);
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
      "[jobs]",
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

// ── the proof's standards section ───────────────────────────────────────────

Deno.test("the proof renders the standards section and the limits-verified line", async () => {
  await withTempDir(async (dir) => {
    await scaffoldEngine(dir);
    await writeConfig(dir, covConfig({ limit: 80 }));
    await gitInit(dir);
    // A committed branch ahead of the trunk, so a proof is rendered.
    await git(dir, "checkout", "-qb", "agent/std-proof");
    await Deno.writeTextFile(join(dir, "work.txt"), "w\n");
    await git(dir, "add", "work.txt");
    await git(dir, "commit", "-qm", "work", "--no-gpg-sign");

    const r = await runAgent(dir, ["done"]);
    assertEquals(r.code, 0, r.output);
    const markdown = r.output;
    assertStringIncludes(markdown, "Standards (limits verified against");
    assertStringIncludes(markdown, "`cov` 90 (floor 80, improved)");
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
    assertEquals(
      await targetExists(join(dir, "prepared.flag")),
      false,
      "prepare must not run a standard's measurement",
    );
    const obj = decodeCliResult(r.stdout, "prepare");
    const step = (obj.steps ?? []).find((s) => s.label.startsWith("standard:"));
    assertEquals(step, undefined, r.stdout);
  });
});
