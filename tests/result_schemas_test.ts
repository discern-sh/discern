/**
 * Faithfulness coverage for the typed result schemas (ADR 0041) — the runtime guard
 * that makes the SSOT spine real. For every verb it runs the REAL core (across the
 * modes it can reach) and asserts the actual `serializeResult` output validates
 * against the verb's declared output schema. If a core ever returns a shape its
 * schema doesn't model, a test here fails — which is exactly what keeps the MCP
 * `outputSchema` (validated by the SDK on every call) from turning a valid call into
 * an error.
 *
 * The envelope schema itself is locked to `serializeResult` by the first test: a
 * maximal result must serialize to exactly the envelope's keys, so a new field in
 * `serializeResult` fails here until the schema models it.
 */

import { assert, assertEquals } from "@std/assert";
import { join } from "@std/path";
import type { z } from "@zod/zod";
import { withTempDir } from "./helpers.ts";
import {
  addWorktree,
  git,
  gitInit,
  scaffoldEngine,
  writeConfig,
} from "./engine_helpers.ts";
import {
  type DiscernResult,
  FAILED_STAGES,
  serializeResult,
  STEP_DISPOSITIONS,
  STEP_KINDS,
  STEP_OUTCOMES,
} from "../src/shared/result.ts";
import {
  AuditOutputSchema,
  ChangedScopesOutputSchema,
  type CouplingData,
  CouplingOutputSchema,
  DatalessEnvelopeSchema,
  DocsOutputSchema,
  DoctorOutputSchema,
  EnvelopeSchema,
  FinishOutputSchema,
  GateDataSchema,
  StartOutputSchema,
  StatusDataSchema,
  StatusOutputSchema,
  StepResultJsonSchema,
} from "../src/shared/result_schemas.ts";
import { FEATURES } from "../src/shared/features.ts";
import { finishResult } from "../src/engine/gate/finish.ts";
import { prepareResult } from "../src/engine/gate/prepare.ts";
import { testResult } from "../src/engine/gate/test.ts";
import { ratchetsResult } from "../src/engine/gate/ratchets.ts";
import { doctorResult } from "../src/commands/doctor.ts";
import { changedScopesResult } from "../src/engine/scopes/changed.ts";
import { couplingResult } from "../src/engine/coupling/coupling.ts";
import { statusResult } from "../src/engine/status/status.ts";
import { auditResult } from "../src/engine/audit/audit.ts";
import { docsResult, helpResult } from "../src/commands/docs.ts";
import {
  graduateResult,
  lifecycleContext,
  startResult,
} from "../src/engine/worktree/lifecycle.ts";
import { resolveWorktreeRoot } from "../src/lib/paths.ts";
import { Logger } from "../src/lib/log.ts";

/** Validate a real verb result's serialized form against its declared schema, with a
 * readable failure (the Zod issues + the offending payload) when it drifts. */
function expectValid(
  schema: z.ZodType,
  result: DiscernResult,
  label: string,
): void {
  const serialized = serializeResult(result);
  const parsed = schema.safeParse(serialized);
  assert(
    parsed.success,
    `${label} drifted from its schema:\n${
      JSON.stringify(parsed.success ? [] : parsed.error.issues, null, 2)
    }\n--- serialized result ---\n${JSON.stringify(serialized, null, 2)}`,
  );
}

Deno.test("envelope schema is locked to serializeResult's wire shape", () => {
  // A maximal result — every envelope field populated — so its serialized keys are
  // the full envelope key set. If serializeResult gains a field the schema doesn't
  // model, the subset check below fails until the schema is updated.
  const maximal: DiscernResult = {
    ok: false,
    verb: "demo",
    dry_run: true,
    plan: {
      title: "Plan",
      details: ["detail"],
      steps: [{
        kind: "job",
        label: "l",
        disposition: "run",
        note: "n",
        group: "g",
      }],
    },
    steps: [{
      step: {
        kind: "job",
        label: "l",
        disposition: "run",
        note: "n",
        group: "g",
      },
      outcome: "ok",
      durationS: 3,
    }],
    diagnostics: [{
      tool: "t",
      severity: "error",
      message: "m",
      reproduce_cmd: "c",
      output: "o",
      truncated: true,
      file: "f",
      line: 1,
      col: 2,
      rule: "r",
      fix_available: true,
    }],
    data: { anything: 1 },
    hints: ["h"],
    error: "e",
    message: "msg",
  };
  const serialized = serializeResult(maximal);
  expectValid(EnvelopeSchema, maximal, "maximal envelope");
  // Every key serializeResult emits is one the envelope schema declares (and vice
  // versa) — so neither side can grow a field the other doesn't know about.
  const schemaKeys = Object.keys(EnvelopeSchema.shape).sort();
  assertEquals(Object.keys(serialized).sort(), schemaKeys);
});

Deno.test("DatalessEnvelopeSchema forbids a data payload (the data-less SSOT guard)", () => {
  const base = { ok: true, verb: "prepare" };
  // A data-less result validates.
  assert(DatalessEnvelopeSchema.safeParse(base).success);
  // The same result carrying a `data` payload is REJECTED — so a data-less verb
  // that grows a `data` field fails its faithfulness test (and the SDK's output
  // validation) until the payload is modelled. The bare EnvelopeSchema (data:
  // unknown), by contrast, would silently accept it.
  assert(
    !DatalessEnvelopeSchema.safeParse({ ...base, data: { x: 1 } }).success,
  );
  assert(EnvelopeSchema.safeParse({ ...base, data: { x: 1 } }).success);
});

Deno.test("GateDataSchema.failed_stage is the closed FAILED_STAGES vocabulary, not a free string", () => {
  // failed_stage is the gate's failed-stage SSOT, derived as z.enum(FAILED_STAGES).
  // Compile-time totality already forces every label through failMessage; this guards
  // the WIRE side against silently re-opening the class — if the schema were ever
  // weakened back to z.string(), the rejection assertion below fails.
  for (const stage of FAILED_STAGES) {
    assert(
      GateDataSchema.safeParse({ failed_stage: stage, scopes_changed: [] })
        .success,
      `GateDataSchema should accept the failed_stage label "${stage}"`,
    );
  }
  // null (a clean gate) validates.
  assert(
    GateDataSchema.safeParse({ failed_stage: null, scopes_changed: [] })
      .success,
  );
  // Anything OUTSIDE the vocabulary is rejected — the closed-enum invariant.
  assert(
    !GateDataSchema.safeParse({
      failed_stage: "not-a-real-stage",
      scopes_changed: [],
    }).success,
    "GateDataSchema.failed_stage must be the closed FAILED_STAGES enum, not a free string",
  );
});

Deno.test("the step vocabularies (kind/disposition/outcome) are closed enums derived from result.ts", () => {
  // Each enum is z.enum(<SSOT const>), so it can't drift from the union. These loops
  // confirm every member validates AND — the part with teeth — an unknown value is
  // rejected, so a future weakening to z.string() (which would silently re-open the
  // vocabulary) fails here. The minimal valid step is {kind,label,disposition,outcome}.
  const step = (extra: Record<string, unknown>) => ({
    kind: "job",
    label: "l",
    disposition: "run",
    outcome: "ok",
    ...extra,
  });
  for (const kind of STEP_KINDS) {
    assert(
      StepResultJsonSchema.safeParse(step({ kind })).success,
      `step kind "${kind}" should validate`,
    );
  }
  for (const disposition of STEP_DISPOSITIONS) {
    assert(
      StepResultJsonSchema.safeParse(step({ disposition })).success,
      `disposition "${disposition}" should validate`,
    );
  }
  for (const outcome of STEP_OUTCOMES) {
    assert(
      StepResultJsonSchema.safeParse(step({ outcome })).success,
      `outcome "${outcome}" should validate`,
    );
  }
  assert(
    !StepResultJsonSchema.safeParse(step({ kind: "bogus-kind" })).success,
    "step kind must be the closed STEP_KINDS enum, not a free string",
  );
  assert(
    !StepResultJsonSchema.safeParse(step({ disposition: "nope" })).success,
    "disposition must be the closed STEP_DISPOSITIONS enum",
  );
  assert(
    !StepResultJsonSchema.safeParse(step({ outcome: "nope" })).success,
    "outcome must be the closed STEP_OUTCOMES enum",
  );
});

Deno.test("finish result is faithful to FinishOutputSchema (preview, clean, failing)", async () => {
  await withTempDir(async (dir) => {
    await scaffoldEngine(dir);
    await gitInit(dir);

    expectValid(
      FinishOutputSchema,
      await finishResult(dir, { dryRun: true }),
      "finish dry-run",
    );
    expectValid(FinishOutputSchema, await finishResult(dir), "finish clean");

    // A failing capability → steps + a diagnostic + data.failed_stage.
    await writeConfig(
      dir,
      [
        "[project]",
        'slug = "engine-test"',
        "",
        "[capabilities]",
        'lint = "echo nope >&2; exit 1"',
        "",
      ].join("\n"),
    );
    const failing = await finishResult(dir);
    assertEquals(failing.ok, false);
    expectValid(FinishOutputSchema, failing, "finish failing");
  });
});

Deno.test("prepare/test results are faithful (clean and failing)", async () => {
  await withTempDir(async (dir) => {
    await scaffoldEngine(dir);
    await gitInit(dir);
    // Clean no-op scaffold: both pass. They carry no `data`, so they validate
    // against the strict DatalessEnvelopeSchema (which forbids a `data` key).
    expectValid(
      DatalessEnvelopeSchema,
      await prepareResult(dir),
      "prepare clean",
    );
    expectValid(
      DatalessEnvelopeSchema,
      await testResult(dir),
      "test unconfigured",
    );

    await writeConfig(
      dir,
      [
        "[project]",
        'slug = "engine-test"',
        "",
        "[capabilities]",
        'lint = "echo boom >&2; exit 1"',
        'test = "echo bust >&2; exit 1"',
        "",
      ].join("\n"),
    );
    const prep = await prepareResult(dir);
    assertEquals(prep.ok, false);
    expectValid(DatalessEnvelopeSchema, prep, "prepare failing");
    const test = await testResult(dir);
    assertEquals(test.ok, false);
    expectValid(DatalessEnvelopeSchema, test, "test failing");
  });
});

Deno.test("doctor result is faithful (healthy and failing)", async () => {
  await withTempDir(async (dir) => {
    await scaffoldEngine(dir);
    await gitInit(dir);
    expectValid(DoctorOutputSchema, await doctorResult(dir), "doctor healthy");

    await writeConfig(
      dir,
      [
        "[project]",
        'slug = "engine-test"',
        "[capabilities]",
        'lint = "totally-not-a-real-binary-zzz --flag"',
        "",
      ].join("\n"),
    );
    const failing = await doctorResult(dir);
    assertEquals(failing.ok, false);
    expectValid(DoctorOutputSchema, failing, "doctor failing");
  });
});

Deno.test("doctor execution_model is faithful across a rich config (resources, ratchets, scopes)", async () => {
  await withTempDir(async (dir) => {
    await scaffoldEngine(dir);
    await gitInit(dir);
    // A config exercising every corner of the execution-model schema: jobs, a scope
    // gate, a ratchet, and a per-worktree resource (its teardown).
    await writeConfig(
      dir,
      [
        "[project]",
        'slug = "engine-test"',
        "",
        "[capabilities]",
        'format = "fmt ."',
        'lint = "lint ."',
        'test = "run-tests"',
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
        "enabled = true",
        "port = true",
        "",
        "[worktree.resources.db]",
        'create = "createdb @db@"',
        'destroy = "dropdb @db@"',
        "",
      ].join("\n"),
    );
    const result = await doctorResult(dir);
    // The whole envelope — execution_model included — validates against the schema the
    // MCP server advertises as discern_doctor's outputSchema (a strict object, so a
    // conditional step that didn't fit would be rejected here).
    expectValid(DoctorOutputSchema, result, "doctor rich execution_model");
    const model =
      (result.data as { execution_model?: { verb: string }[] }).execution_model;
    assert(
      model !== undefined &&
        model.some((v) => v.verb === "graduate (--to trunk)"),
      "the rich model should cover the worktree verbs",
    );
  });
});

Deno.test("changed-scopes result is faithful", async () => {
  await withTempDir(async (dir) => {
    await scaffoldEngine(dir);
    await gitInit(dir);
    expectValid(
      ChangedScopesOutputSchema,
      await changedScopesResult(dir),
      "changed-scopes",
    );
  });
});

Deno.test("coupling result is faithful (diff-aware, query, and a real partner edge)", async () => {
  await withTempDir(async (dir) => {
    await scaffoldEngine(dir);
    await gitInit(dir);
    const commit = async (
      files: Record<string, string>,
      msg: string,
    ): Promise<void> => {
      for (const [f, c] of Object.entries(files)) {
        await Deno.writeTextFile(join(dir, f), c);
      }
      await git(dir, "add", "-A");
      await git(dir, "commit", "-q", "-m", msg, "--no-gpg-sign");
    };
    // a.ts ↔ b.ts couple in 4 of a.ts's commits, against unrelated noise so the
    // association is statistically significant — surfacing the partner sub-schema, not
    // just the empty-list envelope. Zero-config: no thresholds to set.
    for (let i = 0; i < 4; i++) {
      await commit({ "a.ts": `${i}`, "b.ts": `${i}` }, `ab${i}`);
    }
    for (let i = 0; i < 5; i++) {
      await commit({ [`n${i}.ts`]: "1", [`m${i}.ts`]: "1" }, `noise${i}`);
    }

    // query mode names b.ts as a partner of a.ts — a non-empty partner list.
    const query = await couplingResult(dir, { paths: ["a.ts"] });
    expectValid(CouplingOutputSchema, query, "coupling query");
    assert(
      (query.data as CouplingData).partners.some((p) => p.path === "b.ts"),
      "query mode should surface b.ts as a partner of a.ts",
    );

    // diff-aware mode: stage a.ts only → b.ts surfaces as a missing partner.
    await Deno.writeTextFile(join(dir, "a.ts"), "staged");
    const diff = await couplingResult(dir);
    expectValid(CouplingOutputSchema, diff, "coupling diff");
    assert(
      (diff.data as CouplingData).mode === "diff",
      "no-path mode is diff-aware",
    );

    // evidence mode (two paths): the shared-history payload — its commit sub-schema and
    // the of-N denominators — validates too, not just the empty-list envelope.
    const evidence = await couplingResult(dir, { paths: ["a.ts", "b.ts"] });
    expectValid(CouplingOutputSchema, evidence, "coupling evidence");
    const ev = evidence.data as CouplingData;
    assert(
      ev.mode === "evidence" && (ev.together ?? 0) >= 1 &&
        (ev.commits ?? []).length >= 1,
      "evidence mode reports the commits a.ts and b.ts shared",
    );
  });
});

Deno.test("status features schema reports exactly the FEATURES set (SSOT pin)", () => {
  // The feature snapshot is derived from FEATURES; this pins the schema's shape to
  // that SSOT so a newly-added feature can't silently drop out of status.
  assertEquals(
    Object.keys(StatusDataSchema.shape.features.shape).sort(),
    [...FEATURES].sort(),
  );
});

Deno.test("status result is faithful across modes (main, fleet, worktree, unset-up)", async () => {
  await withTempDir(async (dir) => {
    await scaffoldEngine(dir);
    await gitInit(dir);
    // Main checkout, local view.
    const mainStatus = await statusResult(dir);
    expectValid(StatusOutputSchema, mainStatus, "status main");
    // Every feature toggle is reported (the end-to-end side of the SSOT pin).
    assertEquals(
      Object.keys(
        (mainStatus.data as { features: Record<string, boolean> }).features,
      ).sort(),
      [...FEATURES].sort(),
      "status data.features must carry every FEATURES toggle",
    );
    // Main checkout with the fleet survey forced on (exercises StatusFleetEntry).
    expectValid(
      StatusOutputSchema,
      await statusResult(dir, { all: true }),
      "status main --all",
    );
    // Conflicting flags → an operational refusal envelope.
    expectValid(
      StatusOutputSchema,
      await statusResult(dir, { all: true, local: true }),
      "status conflicting flags",
    );

    // From inside a worktree → location "worktree", a worktree block.
    const wt = await addWorktree(dir, "stat");
    expectValid(
      StatusOutputSchema,
      await statusResult(wt),
      "status worktree",
    );
  });

  // A not-yet-bootstrapped project → data.setup_unfinished present.
  await withTempDir(async (dir) => {
    await scaffoldEngine(dir, { bootstrapped: false });
    await gitInit(dir);
    const result = await statusResult(dir);
    assert(
      (result.data as { setup_unfinished?: unknown }).setup_unfinished !==
        undefined,
      "expected setup_unfinished while un-bootstrapped",
    );
    expectValid(StatusOutputSchema, result, "status unset-up");
  });
});

Deno.test("audit result is faithful (full, category, below-min, unknown category)", async () => {
  await withTempDir(async (dir) => {
    await scaffoldEngine(dir);
    await gitInit(dir);
    expectValid(AuditOutputSchema, await auditResult(dir), "audit full");
    expectValid(
      AuditOutputSchema,
      await auditResult(dir, { category: "gate" }),
      "audit one category",
    );
    const belowMin = await auditResult(dir, { minScore: 200 });
    assertEquals(belowMin.ok, false);
    expectValid(AuditOutputSchema, belowMin, "audit below-min");
    const unknown = await auditResult(dir, { category: "no-such-category" });
    assertEquals(unknown.ok, false);
    expectValid(AuditOutputSchema, unknown, "audit unknown category");
  });
});

Deno.test("docs/help results are faithful (index, single doc, not-found, no-tree)", async () => {
  await withTempDir(async (dir) => {
    await scaffoldEngine(dir);
    await gitInit(dir);

    // No docs/ tree yet → a no_docs error envelope (no data).
    expectValid(DocsOutputSchema, await docsResult(dir), "docs no-tree");

    // Seed a tiny tree → index + single doc + not-found.
    await Deno.mkdir(join(dir, "docs", "00-orientation"), { recursive: true });
    await Deno.writeTextFile(
      join(dir, "docs", "00-orientation", "concepts.md"),
      "# Concepts\n\nThe core ideas.\n",
    );
    const index = await docsResult(dir);
    expectValid(DocsOutputSchema, index, "docs index");
    const slug = (index.data as { docs: { slug: string }[] }).docs[0]?.slug;
    assert(slug !== undefined);
    expectValid(
      DocsOutputSchema,
      await docsResult(dir, { target: slug }),
      "docs single",
    );
    expectValid(
      DocsOutputSchema,
      await docsResult(dir, { target: "no-such-doc" }),
      "docs not-found",
    );

    // help reads discern's OWN bundled docs (always present in this repo's build).
    expectValid(DocsOutputSchema, await helpResult(dir), "help index");
    expectValid(
      DocsOutputSchema,
      await helpResult(dir, { target: "config-reference" }),
      "help single",
    );
    expectValid(
      DocsOutputSchema,
      await helpResult(dir, { target: "no-such-doc" }),
      "help not-found",
    );
  });
});

Deno.test("ratchets result is faithful (dry-run plan and applied steps)", async () => {
  await withTempDir(async (dir) => {
    await scaffoldEngine(dir);
    await gitInit(dir);
    await writeConfig(
      dir,
      [
        "[project]",
        'slug = "engine-test"',
        "",
        "[ratchets.coverage]",
        'run = "echo DISCERN_METRIC coverage 90"',
        'direction = "up"',
        "limit = 80",
        "",
      ].join("\n"),
    );
    expectValid(
      DatalessEnvelopeSchema,
      await ratchetsResult(dir, { dryRun: true }),
      "ratchets dry-run",
    );
    const applied = await ratchetsResult(dir);
    assertEquals(applied.ok, true);
    expectValid(DatalessEnvelopeSchema, applied, "ratchets applied");
  });
});

Deno.test("graduate result is faithful (dry-run plan from a worktree)", async () => {
  await withTempDir(async (dir) => {
    await scaffoldEngine(dir);
    await gitInit(dir);
    const wt = await addWorktree(dir, "grad");
    const ctx = await lifecycleContext(
      wt,
      new Logger({ json: true, noColor: true }),
    );
    const preview = await graduateResult(ctx, { dryRun: true });
    assertEquals(preview.dry_run, true);
    expectValid(DatalessEnvelopeSchema, preview, "graduate dry-run");
  });
});

Deno.test("start result is faithful (dry-run preview and applied worktree)", async () => {
  await withTempDir(async (dir) => {
    await scaffoldEngine(dir);
    await gitInit(dir);
    const ctx = await lifecycleContext(
      dir,
      new Logger({ json: true, noColor: true }),
    );
    const worktreeRoot = resolveWorktreeRoot(ctx.root, ctx.config);

    // dry-run: a preview plan, no data.
    const preview = await startResult(ctx, { dryRun: true, worktreeRoot });
    assertEquals(preview.dry_run, true);
    expectValid(StartOutputSchema, preview, "start dry-run");

    // applied: steps + data (the new worktree) + the re-root hint.
    const applied = await startResult(ctx, { worktreeRoot });
    assertEquals(applied.ok, true);
    expectValid(StartOutputSchema, applied, "start applied");
  });
});
