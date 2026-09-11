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
 *  - MODELED OR ABSENT: every top-level verb is either represented by a plan or
 *    recorded outside this model with a reason — exactly one of the two.
 *
 * These call {@link buildExecutionModel} directly against a parsed config (pure, no
 * subprocess); the real-binary surface is covered in `doctor_test.ts`.
 *
 * Guards: boundary:planned-owned-effects
 */

import { assert, assertEquals, assertStringIncludes } from "@std/assert";
import { parseConfigOrThrow } from "../src/shared/config_schema.ts";
import { STAGES } from "../src/shared/capabilities.ts";
import { BUILT_IN_STEP_LABELS, STEP_KINDS } from "../src/shared/result.ts";
import { KNOWN_VERBS } from "../src/engine/dispatch.ts";
import {
  buildExecutionModel,
  STAGE_HINTS,
  STEP_KIND_ANNOTATIONS,
} from "../src/engine/doctor/execution_model.ts";
import {
  buildGatePlan,
  buildPreparePlan,
  gatePlanToEngine,
  stageGroup,
} from "../src/engine/gate/plan.ts";
import {
  buildStandardPlan,
  standardPlanToEngine,
} from "../src/engine/gate/standard_plan.ts";
import { planStandardJobsFromConfig } from "../src/engine/gate/standards_gate.ts";
import { resolveGeneratedGroups } from "../src/shared/generated_artifacts.ts";
import {
  acceptPlanToEngine,
  updatePlanToEngine,
} from "../src/engine/worktree/plan.ts";

/** A config rich enough to induce EVERY step kind across the whole model: a job in
 * each stage, a scope gate, a standard, a per-worktree resource (create/destroy/
 * ensure), inherit-env + a port, and both setup buckets. */
const RICH_TOML = [
  "[project]",
  'slug = "model-test"',
  "",
  "[repository]",
  'ensure = ["install-shared-deps"]',
  "",
  "[jobs]",
  'format = "fmt ."',
  'build = "build ."',
  'lint = "lint ."',
  'test = "run-tests"',
  "",
  "[jobs.licenses]",
  'stage = "check"',
  'run = "check-licenses"',
  "",
  "[scopes.web]",
  'paths = ["web/**"]',
  'gate = "web-gate"',
  "",
  "[generated.bundle]",
  'paths = ["generated/**"]',
  'run = "build-generated"',
  "",
  "[standards.coverage]",
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

const READ_ONLY_ABSENCE =
  "a read or advisory surface with no configurable workflow sequence";
const INSTALLER_ABSENCE =
  "an installer lifecycle outside the project execution model defined by ADR 0063";

/** Top-level verbs the execution model deliberately does not describe. */
const MODELED_VERBS_DELIBERATELY_ABSENT: Readonly<
  Record<string, string>
> = {
  await: READ_ONLY_ABSENCE,
  checkpoints: READ_ONLY_ABSENCE,
  config: "a direct config editor, not a configurable workflow sequence",
  coupling: READ_ONLY_ABSENCE,
  desk: READ_ONLY_ABSENCE,
  enter:
    "an interactive child-shell picker whose destination is runtime input, not a configurable workflow sequence",
  doctor: "the host of the execution model, not a workflow it describes",
  docs: READ_ONLY_ABSENCE,
  help: READ_ONLY_ABSENCE,
  identity: "a command group whose subcommands inspect one worktree identity",
  impact: READ_ONLY_ABSENCE,
  improvement: READ_ONLY_ABSENCE,
  licenses: READ_ONLY_ABSENCE,
  map: READ_ONLY_ABSENCE,
  mcp: "a long-running transport server, not a finite execution plan",
  patterns: READ_ONLY_ABSENCE,
  progress: READ_ONLY_ABSENCE,
  queue:
    "an exec-style resource wrapper whose child command is supplied at invocation time",
  refresh:
    "one direct convergence operation already shown inside modeled workflows",
  scripts:
    "a project-owned command discovered at runtime, with no closed sequence",
  setup: INSTALLER_ABSENCE,
  skills: "a command group whose subcommands act directly on one skill",
  status: READ_ONLY_ABSENCE,
  triangle: READ_ONLY_ABSENCE,
  uninstall: INSTALLER_ABSENCE,
  upgrade: INSTALLER_ABSENCE,
};

/** Exactly-one-of coverage for the hand-enumerated model. */
function modeledVerbOffenders(
  verbs: readonly string[],
  modeled: ReadonlySet<string>,
  deliberatelyAbsent: Readonly<Record<string, string>>,
): string[] {
  const live = new Set(verbs);
  const offenders: string[] = [];
  for (const verb of verbs) {
    const isModeled = modeled.has(verb);
    const isAbsent = Object.hasOwn(deliberatelyAbsent, verb);
    if (!isModeled && !isAbsent) {
      offenders.push(
        `${verb} has no execution model and no deliberate-absence reason`,
      );
    }
    if (isModeled && isAbsent) {
      offenders.push(
        `${verb} is modeled and recorded absent — delete the stale record`,
      );
    }
  }
  for (const [verb, reason] of Object.entries(deliberatelyAbsent)) {
    if (!live.has(verb)) {
      offenders.push(
        `${verb} is recorded absent but is not a live verb — delete the stale record`,
      );
    }
    if (reason.trim().length === 0) {
      offenders.push(`${verb} needs a deliberate-absence reason`);
    }
  }
  for (const verb of modeled) {
    if (!live.has(verb)) {
      offenders.push(`${verb} is modeled but is not a live top-level verb`);
    }
  }
  return offenders;
}

/** Collapse subcommand plans such as `worktree prune` to their live top-level
 * verb (`worktree`) for comparison with {@link KNOWN_VERBS}. */
function modeledTopLevelVerbs(planNames: readonly string[]): Set<string> {
  return new Set(planNames.map((name) => name.split(" ")[0] ?? name));
}

Deno.test("execution model: annotation tables are total over step kinds and stages", () => {
  assertEquals(
    Object.keys(STEP_KIND_ANNOTATIONS).sort(),
    [...STEP_KINDS].sort(),
  );
  assertEquals(Object.keys(STAGE_HINTS).sort(), [...STAGES].sort());
});

Deno.test("execution model: every top-level verb is modeled or recorded deliberately absent", () => {
  const model = buildExecutionModel(parseConfigOrThrow(RICH_TOML));
  const offenders = modeledVerbOffenders(
    [...KNOWN_VERBS],
    modeledTopLevelVerbs(model.map((plan) => plan.verb)),
    MODELED_VERBS_DELIBERATELY_ABSENT,
  );
  assertEquals(
    offenders,
    [],
    "the top-level verb vocabulary and doctor's execution model drifted apart:\n  " +
      offenders.join("\n  "),
  );
});

Deno.test("execution model control: a future verb fails until modeled or recorded absent", () => {
  const unclaimed = modeledVerbOffenders(
    ["done", "future"],
    new Set(["done"]),
    {},
  );
  assertEquals(unclaimed.length, 1, "an unclaimed future verb must offend");
  assert(unclaimed[0]?.includes("future"));
  assertEquals(
    modeledVerbOffenders(
      ["done", "future"],
      new Set(["done"]),
      { future: "not a configurable execution sequence" },
    ),
    [],
    "a live absence with a reason is accounted for",
  );
  assertEquals(
    modeledVerbOffenders(
      ["done"],
      new Set(["done"]),
      { done: "stale" },
    ).length,
    1,
    "a verb cannot be both modeled and recorded absent",
  );
});

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

  // done: the exact label sequence the gate's own plan projection produces (the
  // fail-fast preconditions + every job, standards included, in group order).
  assertEquals(
    labels("done"),
    gatePlanToEngine(
      buildGatePlan(
        cfg,
        Object.keys(cfg.scopes),
        planStandardJobsFromConfig(buildStandardPlan(cfg).standards),
      ),
    ).steps.map((s) => s.label),
  );
  // prepare: the job groups around the built-in refresh boundary.
  const prepare = buildPreparePlan(cfg);
  assertEquals(
    labels("prepare"),
    [
      ...prepare.beforeRefresh.flatMap((group) =>
        group.jobs.map((job) => job.label)
      ),
      prepare.refresh.label,
      ...prepare.afterRefresh.flatMap((group) =>
        group.jobs.map((job) => job.label)
      ),
    ],
  );
  // test: the test-stage job labels.
  assertEquals(
    labels("test"),
    stageGroup(cfg, "test")?.jobs.map((j) => j.label) ?? [],
  );
  // standards: the standard names, in declared order.
  assertEquals(
    labels("standards"),
    standardPlanToEngine(buildStandardPlan(cfg)).steps.map((s) => s.label),
  );
});

Deno.test("execution model: done reports both tracked-refresh checkpoints in execution order", () => {
  const done = buildExecutionModel(parseConfigOrThrow(RICH_TOML)).find((plan) =>
    plan.verb === "done"
  );
  assert(done !== undefined);
  const refreshChecks = done.steps.filter((step) =>
    step.kind === "tracked-refresh-check"
  );
  assertEquals(refreshChecks.map((step) => step.label), [
    BUILT_IN_STEP_LABELS.trackedRefreshCheck,
    BUILT_IN_STEP_LABELS.trackedRefreshProofBoundary,
  ]);
  assertEquals(done.steps.at(-1)?.label, refreshChecks.at(-1)?.label);
});

Deno.test("execution model: update and accept derive their ordered cores from the worktree plans", () => {
  const cfg = parseConfigOrThrow(RICH_TOML);
  const model = buildExecutionModel(cfg);
  const update = model.find((plan) => plan.verb === "update");
  const accept = model.find((plan) => plan.verb === "accept");
  assert(update !== undefined);
  assert(accept !== undefined);

  const updatePlan = updatePlanToEngine({
    source: cfg.repository.trunk,
    fromOverride: false,
    worktreeBranch: "agent/model-test",
    behind: 1,
    alreadyUpdated: false,
    generatedGroups: resolveGeneratedGroups(cfg),
    refreshCompiledPaths: [],
    repositoryEnsureSteps: cfg.repository.ensure,
    worktreeEnsureSteps: cfg.worktree.setup.ensure,
  });
  assertEquals(
    update.steps.map((step) => step.label),
    updatePlan.steps.map((step) => step.label),
  );

  const acceptPlan = acceptPlanToEngine({
    worktreeBranch: "agent/model-test",
    worktreePath: "/repo.worktrees/model-test",
    mainRepo: "/repo",
    trunk: cfg.repository.trunk,
    proofNotes: cfg.repository.proof_notes,
    repositoryEnsureSteps: cfg.repository.ensure,
    smokeSteps: [],
    hasResources: true,
    ignoredFileChanges: {
      status: "unchanged",
      changed_roots: [],
      changed_total: 0,
      truncated: false,
    },
  });
  const acceptLabels = acceptPlan.steps.flatMap((step) =>
    step.kind === "resource-destroy" ? ["db"] : [step.label]
  );
  assertEquals(accept.steps.map((step) => step.label), acceptLabels);
});

Deno.test("execution model: every full refresh step names the complete operation", () => {
  const model = buildExecutionModel(parseConfigOrThrow(RICH_TOML));
  const refreshSteps = model.flatMap((plan) =>
    plan.steps.filter((step) => step.kind === "refresh").map((step) => ({
      verb: plan.verb,
      step,
    }))
  );
  const fullRefreshSteps = refreshSteps.filter(({ step }) =>
    step.label !== BUILT_IN_STEP_LABELS.materializeLocalAgentArtifacts
  );
  assert(fullRefreshSteps.length > 0);
  for (const { verb, step } of fullRefreshSteps) {
    assertEquals(
      step.label,
      BUILT_IN_STEP_LABELS.completeRefresh,
      `${verb} must name the complete refresh operation`,
    );
    assertStringIncludes(
      step.note ?? "",
      "complete refresh",
      `${verb} must explain the complete refresh boundary`,
    );
  }
});

Deno.test("execution model: tidy uses the registered built-in labels", () => {
  const model = buildExecutionModel(parseConfigOrThrow(RICH_TOML));
  const tidy = model.find((plan) => plan.verb === "tidy");
  assertEquals(tidy?.steps.map((step) => step.label), [
    BUILT_IN_STEP_LABELS.configuredMarkdown,
    BUILT_IN_STEP_LABELS.rootDiscernToml,
  ]);
});

Deno.test("execution model: actor matches the user-configured vs built-in split", () => {
  const model = buildExecutionModel(parseConfigOrThrow(RICH_TOML));
  // The two-way split must be consistent: a `project` step is a config-authored command;
  // a `discern` step is a built-in operation. (The job/check/scope/standard/resource/
  // setup kinds are the user's; the precondition/git/env/refresh kinds are discern's.)
  const userKinds = new Set([
    "job",
    "scope-gate",
    "standard",
    "resource-create",
    "resource-destroy",
    "setup-step",
    "repository-ensure",
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
  // The motivating case ("why did accept tear down my database?"): the user's destroy
  // command is surfaced verbatim as a [project] step in both accept forms and prune.
  for (
    const verb of [
      "accept",
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

Deno.test("execution model: every declared plan is always modeled (ADR 0101)", () => {
  const cfg = parseConfigOrThrow(
    [
      "[project]",
      'slug = "model-test"',
      "",
    ].join("\n"),
  );
  // The subsystems are all core, so every plan in the model remains visible on
  // a bare config. The modeled-or-absent guard above holds this declared subset
  // against the full CLI/MCP verb surface.
  const model = buildExecutionModel(cfg);
  assertEquals(model.map((v) => v.verb), [
    "done",
    "prepare",
    "test",
    "standards",
    "tidy",
    "start",
    "worktree ensure",
    "update",
    "accept",
    "worktree prune",
  ]);
  const accept = model.find((plan) => plan.verb === "accept");
  const teardown = accept?.steps.find((step) =>
    step.kind === "resource-destroy"
  );
  assertStringIncludes(teardown?.condition ?? "", "skipped");
});
