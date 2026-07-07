/**
 * The execution-model forcing functions (ADR 0063) — the guards that keep
 * `discern doctor`'s "what runs when" model honest and complete.
 *
 *  - COVERAGE: every engine `STEP_KIND` is documented by at least one verb, so a new
 *    step kind fails the suite until doctor annotates it (the compile-total hint
 *    `Record` is the sibling guard the type checker enforces).
 *  - BYTE-DERIVED: each gate verb's step list is reconstructed from the SAME plan
 *    builders the gate executes, asserted label-for-label — so the model can never
 *    become a parallel hand-copy that drifts from what the gate actually runs.
 *
 * These call {@link buildExecutionModel} directly against a parsed config (pure, no
 * subprocess); the real-binary surface is covered in `doctor_test.ts`.
 */

import { assert, assertEquals } from "@std/assert";
import { parseConfigOrThrow } from "../src/shared/config_schema.ts";
import { STEP_KINDS } from "../src/shared/result.ts";
import { buildExecutionModel } from "../src/engine/doctor/execution_model.ts";
import {
  buildGatePlan,
  gatePlanToEngine,
  preparePlanGroups,
  stageGroup,
} from "../src/engine/gate/plan.ts";
import {
  buildRatchetPlan,
  ratchetPlanToEngine,
} from "../src/engine/gate/ratchet_plan.ts";

/** A config rich enough to induce EVERY step kind across the whole model: a job in
 * each stage, a scope gate, a ratchet, a per-worktree resource (create/destroy/
 * ensure), inherit-env + a port, and both setup buckets. */
const RICH_TOML = [
  "[project]",
  'slug = "model-test"',
  "",
  "[capabilities]",
  'format = "fmt ."',
  'build = "build ."',
  'lint = "lint ."',
  'test = "run-tests"',
  "",
  "[checks.licenses]",
  'stage = "check"',
  'run = "check-licenses"',
  "",
  "[scopes.web]",
  'paths = ["web/**"]',
  'gate = "web-gate"',
  "",
  "[ratchets.coverage]",
  'run = "measure-coverage"',
  'direction = "up"',
  "limit = 80",
  "",
  "[worktree]",
  "port = true",
  'inherit_env = ["SECRET"]',
  "",
  "[worktree.resources.db]",
  'create = "createdb @db@"',
  'destroy = "dropdb @db@"',
  'ensure = "ensure-db @db@"',
  "",
  "[worktree.setup]",
  'steps = ["seed-fixtures"]',
  'ensure = ["install-deps"]',
  "",
].join("\n");

Deno.test("execution model: every STEP_KIND is documented by some verb (coverage forcing function)", () => {
  const model = buildExecutionModel(parseConfigOrThrow(RICH_TOML));
  const seen = new Set(model.flatMap((v) => v.steps.map((s) => s.kind)));
  for (const kind of STEP_KINDS) {
    assert(
      seen.has(kind),
      `STEP_KIND "${kind}" must appear in at least one verb's execution_model — ` +
        "document it in src/engine/doctor/execution_model.ts.",
    );
  }
});

Deno.test("execution model: gate verbs are byte-derived from the real plan builders (no parallel copy)", () => {
  const cfg = parseConfigOrThrow(RICH_TOML);
  const model = buildExecutionModel(cfg);
  const labels = (verb: string): string[] => {
    const vp = model.find((v) => v.verb === verb);
    assert(vp !== undefined, `expected a '${verb}' verb`);
    return vp.steps.map((s) => s.label);
  };

  // finish: the exact label sequence the gate's own plan projection produces (the
  // fail-fast preconditions + every job, in group order).
  assertEquals(
    labels("finish"),
    gatePlanToEngine(buildGatePlan(cfg, Object.keys(cfg.scopes))).steps.map(
      (s) => s.label,
    ),
  );
  // prepare: the fix + check job labels, from preparePlanGroups.
  assertEquals(
    labels("prepare"),
    preparePlanGroups(cfg).flatMap((g) => g.jobs.map((j) => j.label)),
  );
  // test: the test-stage job labels.
  assertEquals(
    labels("test"),
    stageGroup(cfg, "test")?.jobs.map((j) => j.label) ?? [],
  );
  // ratchets: the ratchet names, in declared order.
  assertEquals(
    labels("ratchets"),
    ratchetPlanToEngine(buildRatchetPlan(cfg)).steps.map((s) => s.label),
  );
});

Deno.test("execution model: actor matches the user-configured vs built-in split", () => {
  const model = buildExecutionModel(parseConfigOrThrow(RICH_TOML));
  // The two-way split must be consistent: a `project` step is a config-authored command;
  // a `discern` step is a built-in operation. (The job/check/scope/ratchet/resource/
  // setup kinds are the user's; the precondition/git/env/refresh kinds are discern's.)
  const userKinds = new Set([
    "job",
    "scope-gate",
    "ratchet",
    "resource-create",
    "resource-destroy",
    "setup-step",
    "setup-ensure",
  ]);
  for (const vp of model) {
    for (const s of vp.steps) {
      const expected = userKinds.has(s.kind) ? "project" : "discern";
      assertEquals(
        s.actor,
        expected,
        `${vp.verb}/${s.label} (${s.kind}) should be actor '${expected}'`,
      );
    }
  }
});

Deno.test("execution model: a resource teardown shows the user's command in every verb that runs it", () => {
  const model = buildExecutionModel(parseConfigOrThrow(RICH_TOML));
  // The motivating case ("why did graduate tear down my database?"): the user's destroy
  // command is surfaced verbatim as a [project] step in both graduate forms and prune.
  for (
    const verb of [
      "graduate (--to branch)",
      "graduate (--to trunk)",
      "worktree prune",
    ]
  ) {
    const vp = model.find((v) => v.verb === verb);
    assert(vp !== undefined, `expected a '${verb}' verb`);
    const destroy = vp.steps.find(
      (s) => s.kind === "resource-destroy" && s.label === "db",
    );
    assert(destroy !== undefined, `${verb} should tear down the db resource`);
    assertEquals(destroy.actor, "project");
    assertEquals(destroy.note, "dropdb @db@");
  }
});

Deno.test("execution model: every configurable verb is always modeled (ADR 0101)", () => {
  const cfg = parseConfigOrThrow(
    [
      "[project]",
      'slug = "model-test"',
      "",
    ].join("\n"),
  );
  // The subsystems are all core, so the model covers the full verb surface even
  // on a bare config — the MCP/CLI verb surface and the doctor model stay in
  // lockstep.
  assertEquals(buildExecutionModel(cfg).map((v) => v.verb), [
    "finish",
    "prepare",
    "test",
    "ratchets",
    "start",
    "worktree ensure",
    "integrate",
    "graduate (--to branch)",
    "graduate (--to trunk)",
    "worktree prune",
  ]);
});
