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

import { assert, assertEquals, assertThrows } from "@std/assert";
import { join } from "@std/path";
import type { z } from "@zod/zod";
import { withTempDir } from "./helpers.ts";
import {
  AUTHORED_TS_FILES,
  isRepoMapPath,
  REPO_ROOT,
  TRACKED_MD_FILES,
} from "./repo_authored_paths.ts";
import {
  addWorktree,
  defaultMapPath,
  git,
  gitInit,
  runAgent,
  scaffoldEngine,
  writeConfig,
} from "./engine_helpers.ts";
import {
  type DiscernResult,
  ERROR_SLUGS,
  FAILED_STAGES,
  STEP_DISPOSITIONS,
  STEP_KINDS,
  STEP_OUTCOMES,
} from "../src/shared/result.ts";
import { serializeResult } from "../src/shared/result_serialization.ts";
import {
  FAILURE_RECOVERY_EVIDENCE,
  failureRecoveryHintTexts,
  fire,
  hasRegisteredActionableHint,
  HINTS,
  hintTexts,
  withFailureRecoveryHint,
} from "../src/shared/hints.ts";
import {
  type CouplingData,
  DatalessEnvelopeSchema,
  EnvelopeSchema,
  GateDataSchema,
  StepResultJsonSchema,
} from "../src/shared/result_schemas.ts";
import { loadConfig } from "../src/shared/config_schema.ts";
import { skillsListResult } from "../src/lib/skills.ts";
import {
  CLI_JSON_RESULT_CONTRACTS,
  MCP_RESULT_CONTRACTS,
} from "../src/shared/result_contracts.ts";
import { finishResult } from "../src/engine/gate/finish.ts";
import { prepareResult } from "../src/engine/gate/prepare.ts";
import { testResult } from "../src/engine/gate/test.ts";
import { standardsResult } from "../src/engine/gate/standards.ts";
import { doctorResult } from "../src/commands/doctor.ts";
import { impactResult } from "../src/engine/scopes/scopes.ts";
import { couplingResult } from "../src/engine/coupling/coupling.ts";
import { statusResult } from "../src/engine/status/status.ts";
import {
  patternsResetResult,
  patternsResult,
} from "../src/engine/logbook/patterns.ts";
import { improvementResult } from "../src/engine/improve/improve.ts";
import { helpResult, mapResult } from "../src/commands/docs.ts";
import { refreshResult } from "../src/engine/guidelines.ts";
import { tidyResult } from "../src/engine/tidy/tidy.ts";
import {
  acceptResult,
  lifecycleContext,
  startResult,
  updateResult,
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

/** Contract ids `expectFaithful` actually exercised this run — the evidence the
 * file's final test reconciles against FAITHFULNESS_COVERED. */
const FAITHFULNESS_EXERCISED = new Set<string>();

/** Validate a real verb result against the PUBLISHED schema of the contract it
 * claims — looked up in the registry, so the id and the schema cannot be
 * mismatched — and record the id as faithfulness evidence. The id is recorded
 * before the validity assertion: a currently-failing faithfulness test is
 * still coverage (its assertion is what reports the drift). */
function expectFaithful(
  contractId: string,
  result: DiscernResult,
  label: string,
): void {
  expectSerializedFaithful(
    contractId,
    serializeResult(result),
    label,
  );
}

/** Validate an already serialized real CLI envelope against its contract. */
function expectSerializedFaithful(
  contractId: string,
  serialized: unknown,
  label: string,
): void {
  const contract = CLI_JSON_RESULT_CONTRACTS.find((c) => c.id === contractId);
  assert(
    contract !== undefined,
    `expectFaithful("${contractId}") names no published contract`,
  );
  FAITHFULNESS_EXERCISED.add(contractId);
  const parsed = contract.schema.safeParse(serialized);
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
      outputPath: "/tmp/discern-job-demo.log",
      outputLines: 4,
      errorLikeLines: 2,
    }],
    diagnostics: [{
      tool: "t",
      severity: "error",
      message: "m",
      reproduce_cmd: "c",
      output: "o",
      truncated: true,
      output_path: "/tmp/discern-diag-demo.log",
      file: "f",
      line: 1,
      col: 2,
      rule: "r",
      fix_available: true,
    }],
    data: { anything: 1 },
    hints: hintTexts([fire(HINTS["failure-recovery"], { verb: "demo" })]),
    error: "internal_error",
    message: "msg",
  };
  const serialized = serializeResult(maximal);
  expectValid(EnvelopeSchema, maximal, "maximal envelope");
  // Every key serializeResult emits is one the envelope schema declares (and vice
  // versa) — so neither side can grow a field the other doesn't know about.
  const schemaKeys = Object.keys(EnvelopeSchema.shape).sort();
  assertEquals(Object.keys(serialized).sort(), schemaKeys);
});

Deno.test("failed-result serialization requires a registered next-step hint", () => {
  const failure = (hints?: string[]): DiscernResult => ({
    ok: false,
    verb: "demo",
    error: "internal_error",
    message: "The operation failed.",
    ...(hints === undefined ? {} : { hints }),
  });
  for (
    const hints of [
      undefined,
      ["an inline instruction"],
      hintTexts([fire(HINTS["patterns-logbook-empty"])]),
      hintTexts([fire(HINTS["status-start-on-trunk"])]),
    ]
  ) {
    assertThrows(
      () => serializeResult(failure(hints)),
      Error,
      "failed `discern demo` result has no registered next-step hint",
    );
  }

  const actionable = hintTexts([
    fire(HINTS["failure-recovery"], { verb: "demo" }),
  ]);
  assertEquals(
    serializeResult(failure(actionable)).hints,
    actionable,
  );
  assertEquals(
    serializeResult({ ok: true, verb: "demo" }),
    { ok: true, verb: "demo" },
    "successful results need no recovery hint",
  );
});

Deno.test("wire preparation adds one registered recovery floor without clobbering stronger hints", () => {
  const notice = hintTexts([fire(HINTS["patterns-logbook-empty"])]);
  const recovered = withFailureRecoveryHint({
    ok: false,
    verb: "demo",
    error: "internal_error",
    message: "The operation failed.",
    hints: notice,
  });
  assertEquals(recovered.hints?.[0], notice[0]);
  assert(hasRegisteredActionableHint(recovered.hints));
  assertEquals(
    withFailureRecoveryHint(recovered),
    recovered,
    "preparation should be idempotent once recovery is actionable",
  );
  assertEquals(
    serializeResult(recovered).hints,
    recovered.hints,
  );

  const tailored = {
    ok: false,
    verb: "demo",
    error: "internal_error",
    hints: hintTexts([fire(HINTS["unknown-command-help"])]),
  } satisfies DiscernResult;
  assertEquals(
    withFailureRecoveryHint(tailored),
    tailored,
    "a registered tailored next step should pass through unchanged",
  );
});

Deno.test("generic failure recovery is legal only across the complete evidence × tailored-hint matrix", () => {
  const tailored = hintTexts([fire(HINTS["unknown-command-help"])]);
  const combinations = 1 << FAILURE_RECOVERY_EVIDENCE.length;

  for (let mask = 0; mask < combinations; mask += 1) {
    const evidence = new Set(
      FAILURE_RECOVERY_EVIDENCE.filter((_, index) =>
        (mask & (1 << index)) !== 0
      ),
    );
    for (const hasTailoredHint of [false, true]) {
      const failure = {
        ok: false,
        verb: "demo",
        error: "internal_error",
        data: { evidence: [...evidence] },
        ...(evidence.has("message")
          ? { message: "The configured operation failed." }
          : {}),
        ...(evidence.has("diagnostic")
          ? {
            diagnostics: [{
              tool: "demo",
              severity: "error",
              message: "demo failed",
              reproduce_cmd: "discern demo",
            }] as const,
          }
          : {}),
        ...(hasTailoredHint ? { hints: tailored } : {}),
      } satisfies DiscernResult;
      const prepared = withFailureRecoveryHint(failure);
      const context = `evidence=${
        [...evidence].join("+") || "none"
      }, tailored=${hasTailoredHint}`;

      if (hasTailoredHint) {
        assertEquals(
          prepared,
          failure,
          `${context}: tailored recovery must pass through unchanged`,
        );
        serializeResult(prepared);
      } else if (evidence.size > 0) {
        assert(
          hasRegisteredActionableHint(prepared.hints),
          `${context}: evidence-backed failure needs the generic recovery floor`,
        );
        serializeResult(prepared);
      } else {
        assertEquals(
          prepared,
          failure,
          `${context}: data-only failures must not receive a fabricated fallback`,
        );
        assertThrows(
          () => serializeResult(prepared),
          Error,
          "has no registered next-step hint",
        );
      }
    }
  }

  const unsupported = {
    ok: false,
    verb: "demo",
    error: "internal_error",
    data: { only: "data" },
    hints: failureRecoveryHintTexts("demo"),
  } satisfies DiscernResult;
  assertThrows(
    () => serializeResult(unsupported),
    Error,
    "generic failure-recovery hint requires a message or diagnostic",
  );

  for (
    const emptyEvidence of [
      { message: "" },
      { diagnostics: [] },
    ] satisfies readonly Partial<DiscernResult>[]
  ) {
    const failure = {
      ok: false,
      verb: "demo",
      error: "internal_error",
      data: { only: "data" },
      ...emptyEvidence,
    } satisfies DiscernResult;
    assertEquals(
      withFailureRecoveryHint(failure),
      failure,
      "empty evidence must not legalize generic recovery",
    );
  }
});

Deno.test("runtime result schemas accept only the canonical error-slug vocabulary", () => {
  for (const error of ERROR_SLUGS) {
    assert(
      EnvelopeSchema.safeParse({ ok: false, verb: "demo", error }).success,
      `EnvelopeSchema should accept the error slug "${error}"`,
    );
  }
  assert(
    !EnvelopeSchema.safeParse({
      ok: false,
      verb: "demo",
      error: "future_error_slug",
    }).success,
    "runtime result schemas must reject error slugs outside ERROR_SLUGS",
  );
});

Deno.test("every canonical error slug has a production source anchor", async () => {
  const sources = await Promise.all(
    AUTHORED_TS_FILES
      .filter((rel) => rel.startsWith("src/") && rel !== "src/shared/result.ts")
      .map((rel) => Deno.readTextFile(join(REPO_ROOT, rel))),
  );
  const unanchored = ERROR_SLUGS.filter((slug) =>
    !sources.some((text) =>
      text.includes(`"${slug}"`) || text.includes(`'${slug}'`)
    )
  );
  assertEquals(
    unanchored,
    [],
    "ERROR_SLUGS publishes a value with no production source anchor. Remove " +
      "the retired slug before it becomes public v1 baggage, or add the live " +
      "emission path that owns it.",
  );
});

// ── contract-coverage enrollment (the forcing function for NEW contracts) ────
// The `skills list` contract drifted for days because nothing tied the registry
// to this suite: the verb emitted a field its published schema rejected, and no
// test here ever ran it. These two sets close that gap the way the repo's other
// parity guards do (ADR 0051): every contract in CLI_JSON_RESULT_CONTRACTS must
// be enrolled below, so registering a new one fails this file until its
// faithfulness test exists — or its absence is recorded as explicit, reviewable
// debt. Membership in the covered set is not taken on trust: the file's FINAL
// test reconciles it against the ids `expectFaithful` actually exercised, so an
// id added here without its test (the drift incident's dishonest-enrolment
// variant) fails the reconciliation.

/** Contract ids whose REAL core output a test in this file validates via
 * `expectFaithful`. Enrolment is evidence-checked: the final test asserts this
 * set EQUALS the ids exercised, so the only way in is writing the test. */
const FAITHFULNESS_COVERED = new Set<string>([
  "config",
  "coupling",
  "desk",
  "discern",
  "map",
  "doctor",
  "done",
  "accept",
  "help",
  "improvement",
  "update",
  "patterns",
  "patternsReset",
  "prepare",
  "standards",
  "refresh",
  "tidy",
  "impact",
  "identity",
  "licenses",
  "script",
  "skills",
  "skillsList",
  "start",
  "status",
  "test",
  "worktree",
]);

/** Published contracts still awaiting a faithfulness test — explicit debt, not
 * silence. Shrink this set; never grow it for an MCP-exposed contract (the SDK
 * validates structuredContent against the advertised outputSchema on every
 * call, so an unproven schema there turns valid calls into errors). */
const FAITHFULNESS_DEBT = new Set<string>([
  "preset",
  "setup",
  "setupDone",
  "setupAccept",
  "setupStep",
  "setupVerify",
  "skillsEject",
  "uninstall",
  "upgrade",
  "worktreeDrop",
  "worktreePrune",
  "worktreeSetup",
  "worktreeTeardown",
]);

Deno.test("every published result contract is enrolled: faithfulness-covered or explicit debt", () => {
  const ids = new Set(CLI_JSON_RESULT_CONTRACTS.map((c) => c.id));
  for (const id of ids) {
    const covered = FAITHFULNESS_COVERED.has(id);
    const debt = FAITHFULNESS_DEBT.has(id);
    assert(
      covered || debt,
      `contract "${id}" is published but not enrolled here — add a faithfulness ` +
        `test (FAITHFULNESS_COVERED) or record the gap (FAITHFULNESS_DEBT)`,
    );
    assert(
      !(covered && debt),
      `contract "${id}" is enrolled as both covered and debt — pick one`,
    );
  }
  // No stale enrollment: a retired contract must leave the sets too.
  for (const id of [...FAITHFULNESS_COVERED, ...FAITHFULNESS_DEBT]) {
    assert(ids.has(id), `"${id}" is enrolled but no longer in the registry`);
  }
});

Deno.test("no MCP-advertised outputSchema is faithfulness debt", () => {
  // An unfaithful CLI contract mis-labels valid output; an unfaithful MCP
  // outputSchema makes the SDK REJECT valid calls. Exposing a verb over MCP
  // therefore requires promoting it out of the debt set first.
  for (const contract of MCP_RESULT_CONTRACTS) {
    assert(
      FAITHFULNESS_COVERED.has(contract.id),
      `"${contract.id}" is advertised as MCP tool ${contract.mcpTool} but its ` +
        `schema has no faithfulness coverage in this suite`,
    );
  }
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

Deno.test("root, utility, read, and command-group CLI results are faithful", async () => {
  await withTempDir(async (dir) => {
    await scaffoldEngine(dir);
    await gitInit(dir);

    const cases = [
      { id: "discern", args: ["--json"] },
      { id: "licenses", args: ["licenses", "--json"] },
      { id: "script", args: ["script", "--json"] },
      { id: "desk", args: ["desk", "--json"] },
      { id: "worktree", args: ["worktree", "--json"] },
      { id: "skills", args: ["skills", "--json"] },
      {
        id: "config",
        args: ["config", "get", "project.slug", "--json"],
      },
      {
        id: "config",
        args: [
          "config",
          "set",
          "project.name",
          "Faithful",
          "--dry-run",
          "--json",
        ],
      },
    ] as const;

    for (const testCase of cases) {
      const result = await runAgent(dir, [...testCase.args]);
      let envelope: unknown;
      try {
        envelope = JSON.parse(result.stdout);
      } catch {
        throw new Error(
          `${
            testCase.args.join(" ")
          } emitted no JSON envelope:\n${result.output}`,
        );
      }
      expectSerializedFaithful(
        testCase.id,
        envelope,
        testCase.args.join(" "),
      );
    }

    const worktree = await addWorktree(dir, "identity-faithful");
    const identity = await runAgent(worktree, [
      "identity",
      "--port",
      "--json",
    ]);
    assertEquals(identity.code, 0, identity.output);
    expectSerializedFaithful(
      "identity",
      JSON.parse(identity.stdout),
      "identity --port --json",
    );
  });
});

Deno.test("GateDataSchema.failed_stage is the closed FAILED_STAGES vocabulary, not a free string", () => {
  // failed_stage is the gate's failed-stage SSOT, derived as z.enum(FAILED_STAGES).
  // Compile-time totality already forces every label through the remedy index; this guards
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

Deno.test("current-facing prose keeps fail-fast cancellation distinct from skipped work", async () => {
  assert(
    STEP_OUTCOMES.includes("cancelled") && STEP_OUTCOMES.includes("skipped"),
    "this guard follows the canonical STEP_OUTCOMES distinction",
  );
  const currentFacingFiles = [
    ...AUTHORED_TS_FILES.filter((rel) => !rel.startsWith("tests/")),
    ...TRACKED_MD_FILES.filter((rel) =>
      !isRepoMapPath(rel, "_adr") && !isRepoMapPath(rel, "_private")
    ),
  ].sort();
  const conflatesOutcomes =
    /\b(?:fail-fast(?:-cancelled)?\s+(?:collateral|siblings?)|cancelled\s+siblings?)\b[\s\S]{0,240}?\b(?:report(?:ed|s)?(?:\s+as)?|ended)\s+[`"']?skipped\b/i;
  const offenders: string[] = [];
  for (const rel of currentFacingFiles) {
    const text = await Deno.readTextFile(join(REPO_ROOT, rel));
    if (conflatesOutcomes.test(text)) {
      offenders.push(rel);
    }
  }
  assertEquals(
    offenders,
    [],
    "fail-fast-cancelled work must be reported as `cancelled`; reserve `skipped` for work that never ran",
  );
});

Deno.test("done result is faithful to FinishOutputSchema (preview, clean, failing)", async () => {
  await withTempDir(async (dir) => {
    await scaffoldEngine(dir);
    await gitInit(dir);

    expectFaithful(
      "done",
      await finishResult(dir, { dryRun: true }),
      "finish dry-run",
    );
    expectFaithful("done", await finishResult(dir), "finish clean");

    // A failing capability → steps + a diagnostic + data.failed_stage.
    await writeConfig(
      dir,
      [
        "[project]",
        'slug = "engine-test"',
        "",
        "[jobs]",
        'lint = "echo nope >&2; exit 1"',
        "",
      ].join("\n"),
    );
    const failing = await finishResult(dir);
    assertEquals(failing.ok, false);
    expectFaithful("done", failing, "finish failing");
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
    expectFaithful(
      "prepare",
      await prepareResult(dir),
      "prepare clean public schema",
    );
    expectValid(
      DatalessEnvelopeSchema,
      await testResult(dir),
      "test unconfigured",
    );
    expectFaithful(
      "test",
      await testResult(dir),
      "test unconfigured public schema",
    );

    await writeConfig(
      dir,
      [
        "[project]",
        'slug = "engine-test"',
        "",
        "[jobs]",
        'lint = "echo boom >&2; exit 1"',
        'test = "echo bust >&2; exit 1"',
        "",
      ].join("\n"),
    );
    const prep = await prepareResult(dir);
    assertEquals(prep.ok, false);
    expectFaithful("prepare", prep, "prepare failing");
    const test = await testResult(dir);
    assertEquals(test.ok, false);
    expectFaithful("test", test, "test failing");
  });
});

Deno.test("refresh result is faithful to RefreshOutputSchema (clean and partial)", async () => {
  await withTempDir(async (dir) => {
    await scaffoldEngine(dir);
    await gitInit(dir);
    expectFaithful("refresh", await refreshResult(dir), "refresh clean");

    await writeConfig(
      dir,
      [
        "[project]",
        'slug = "engine-test"',
        "",
        "[skills]",
        'dir = "missing-skills"',
        "",
      ].join("\n"),
    );
    await Deno.writeTextFile(join(dir, "missing-skills"), "not a dir\n");
    const partial = await refreshResult(dir);
    assertEquals(partial.ok, false);
    assertEquals(partial.error, "partial_refresh");
    expectFaithful("refresh", partial, "refresh partial");
  });
});

Deno.test("tidy result is faithful in preview and apply modes", async () => {
  await withTempDir(async (dir) => {
    await scaffoldEngine(dir);
    expectFaithful(
      "tidy",
      await tidyResult(dir, { dryRun: true }),
      "tidy preview",
    );
    expectFaithful("tidy", await tidyResult(dir), "tidy apply");
  });
});

Deno.test("doctor result is faithful (healthy and failing)", async () => {
  await withTempDir(async (dir) => {
    await scaffoldEngine(dir);
    await gitInit(dir);
    expectFaithful("doctor", await doctorResult(dir), "doctor healthy");

    await writeConfig(
      dir,
      [
        "[project]",
        'slug = "engine-test"',
        "[jobs]",
        'lint = "totally-not-a-real-binary-zzz --flag"',
        "",
      ].join("\n"),
    );
    const failing = await doctorResult(dir);
    assertEquals(failing.ok, false);
    expectFaithful("doctor", failing, "doctor failing");
  });
});

Deno.test("doctor execution_model is faithful across a rich config (resources, standards, scopes)", async () => {
  await withTempDir(async (dir) => {
    await scaffoldEngine(dir);
    await gitInit(dir);
    // A config exercising every corner of the execution-model schema: jobs, a scope
    // gate, a standard, and a per-worktree resource (its teardown).
    await writeConfig(
      dir,
      [
        "[project]",
        'slug = "engine-test"',
        "",
        "[jobs]",
        'format = "fmt ."',
        'lint = "lint ."',
        'test = "run-tests"',
        "",
        "[scopes.web]",
        'paths = ["web/**"]',
        'gate = "web-gate"',
        "",
        "[standards.coverage]",
        'run = "measure-coverage"',
        'direction = "up"',
        "limit = 80",
        "",
        "[worktree]",
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
    expectFaithful("doctor", result, "doctor rich execution_model");
    const model =
      (result.data as { execution_model?: { verb: string }[] }).execution_model;
    assert(
      model !== undefined &&
        model.some((v) => v.verb === "accept"),
      "the rich model should cover the worktree verbs",
    );
  });
});

Deno.test("impact result is faithful", async () => {
  await withTempDir(async (dir) => {
    await scaffoldEngine(dir);
    await gitInit(dir);
    expectFaithful("impact", await impactResult(dir), "impact");
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
    expectFaithful("coupling", query, "coupling query");
    assert(
      (query.data as CouplingData).partners.some((p) => p.path === "b.ts"),
      "query mode should surface b.ts as a partner of a.ts",
    );

    // diff-aware mode: stage a.ts only → b.ts surfaces as a missing partner.
    await Deno.writeTextFile(join(dir, "a.ts"), "staged");
    const diff = await couplingResult(dir);
    expectFaithful("coupling", diff, "coupling diff");
    assert(
      (diff.data as CouplingData).mode === "diff",
      "no-path mode is diff-aware",
    );

    // evidence mode (two paths): the shared-history payload — its commit sub-schema and
    // the of-N denominators — validates too, not just the empty-list envelope.
    const evidence = await couplingResult(dir, { paths: ["a.ts", "b.ts"] });
    expectFaithful("coupling", evidence, "coupling evidence");
    const ev = evidence.data as CouplingData;
    assert(
      ev.mode === "evidence" && (ev.together ?? 0) >= 1 &&
        (ev.commits ?? []).length >= 1,
      "evidence mode reports the commits a.ts and b.ts shared",
    );
  });
});

Deno.test("patterns result and its reset are faithful (empty, seeded, dry-run, applied)", async () => {
  await withTempDir(async (dir) => {
    await scaffoldEngine(dir);
    await gitInit(dir);
    // The empty-logbook state is first-class and must validate too.
    expectFaithful("patterns", await patternsResult(dir), "patterns empty");

    // Seed one synthetic month: a done-thrash stream (exercises the finding
    // sub-schema), a torn line (the unparsed counter), and a pin event.
    const logDir = join(dir, ".git", "discern", "logbook");
    await Deno.mkdir(logDir, { recursive: true });
    const event = (at: string, outcome: string): string =>
      JSON.stringify({
        schema: 1,
        at,
        kind: "verb",
        verb: "done",
        surface: "cli",
        writer: "9.9.9",
        driver: { session: "cli:1", json: true, tty: false, ci: false },
        branch: "agent/seeded",
        head: "abc1234",
        clean: true,
        outcome,
        ...(outcome === "failed" ? { failed_stage: "check/test" } : {}),
        duration_ms: 1000,
        epoch: "e1",
      });
    await Deno.writeTextFile(
      join(logDir, "2026-07.jsonl"),
      [
        event("2026-07-01T00:00:00.000Z", "failed"),
        event("2026-07-01T01:00:00.000Z", "failed"),
        event("2026-07-01T02:00:00.000Z", "failed"),
        event("2026-07-01T03:00:00.000Z", "ok"),
        '{"schema":1,"kind":"ver',
        JSON.stringify({
          schema: 1,
          at: "2026-07-01T04:00:00.000Z",
          kind: "pin",
          branch: "agent/seeded",
          standard: "cov",
          from: 80,
          to: 85,
          measured: 85,
        }),
      ].join("\n") + "\n",
    );
    const seeded = await patternsResult(dir);
    expectFaithful("patterns", seeded, "patterns seeded");
    const data = seeded.data;
    assert(
      data !== undefined && "findings" in data && data.findings.length > 0,
      "the seeded thrash stream must produce findings, so the finding sub-schema is exercised",
    );

    // The reset's plan (dry-run), apply, and already-empty modes all validate.
    expectFaithful(
      "patternsReset",
      await patternsResetResult(dir, { dryRun: true }),
      "patterns reset dry-run",
    );
    expectFaithful(
      "patternsReset",
      await patternsResetResult(dir),
      "patterns reset",
    );
    expectFaithful(
      "patternsReset",
      await patternsResetResult(dir),
      "patterns reset (nothing left)",
    );
  });
});

Deno.test("status result is faithful across modes (main, fleet, worktree, unset-up)", async () => {
  await withTempDir(async (dir) => {
    await scaffoldEngine(dir);
    await gitInit(dir);
    // Main checkout, local view.
    const mainStatus = await statusResult(dir);
    expectFaithful("status", mainStatus, "status main");
    // Main checkout with the fleet survey forced on (exercises StatusFleetEntry).
    expectFaithful(
      "status",
      await statusResult(dir, { all: true }),
      "status main --all",
    );
    // Conflicting flags → an operational refusal envelope.
    expectFaithful(
      "status",
      await statusResult(dir, { all: true, local: true }),
      "status conflicting flags",
    );

    // From inside a worktree → location "worktree", a worktree block.
    const wt = await addWorktree(dir, "stat");
    expectFaithful("status", await statusResult(wt), "status worktree");
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
    expectFaithful("status", result, "status unset-up");
  });
});

Deno.test("improvement result is faithful (full, category, below-min, unknown)", async () => {
  await withTempDir(async (dir) => {
    await scaffoldEngine(dir);
    await gitInit(dir);
    expectFaithful(
      "improvement",
      await improvementResult(dir),
      "improvement full",
    );
    expectFaithful(
      "improvement",
      await improvementResult(dir, { category: "gate" }),
      "improvement one category",
    );
    const belowMin = await improvementResult(dir, { minScore: 200 });
    assertEquals(belowMin.ok, false);
    expectFaithful("improvement", belowMin, "improvement below-min");
    const unknown = await improvementResult(dir, {
      category: "no-such-category",
    });
    assertEquals(unknown.ok, false);
    expectFaithful("improvement", unknown, "improvement unknown category");
  });
});

Deno.test("map/help results are faithful (index, single doc, not-found, no-tree)", async () => {
  await withTempDir(async (dir) => {
    await scaffoldEngine(dir);
    await gitInit(dir);

    // No map tree yet → a no_map error envelope (no data).
    expectFaithful("map", await mapResult(dir), "map no-tree");

    // Seed a tiny tree → index + single doc + not-found.
    await Deno.mkdir(defaultMapPath(dir, "00-orientation"), {
      recursive: true,
    });
    await Deno.writeTextFile(
      defaultMapPath(dir, "00-orientation", "concepts.md"),
      "# Concepts\n\nThe core ideas.\n",
    );
    const index = await mapResult(dir);
    expectFaithful("map", index, "map index");
    const slug = (index.data as { docs: { slug: string }[] }).docs[0]?.slug;
    assert(slug !== undefined);
    expectFaithful("map", await mapResult(dir, { target: slug }), "map single");
    expectFaithful(
      "map",
      await mapResult(dir, { target: "no-such-doc" }),
      "map not-found",
    );
    expectFaithful(
      "map",
      await mapResult(dir, { search: "core ideas" }),
      "map search",
    );
    expectFaithful(
      "map",
      await mapResult(dir, { target: "00-orientation" }),
      "map region",
    );

    // help reads discern's OWN bundled docs (always present in this repo's build).
    expectFaithful("help", await helpResult(dir), "help index");
    expectFaithful(
      "help",
      await helpResult(dir, { target: "config-reference" }),
      "help single",
    );
    expectFaithful(
      "help",
      await helpResult(dir, { target: "no-such-doc" }),
      "help not-found",
    );
    expectFaithful(
      "help",
      await helpResult(dir, { search: "worktree resources" }),
      "help search",
    );
  });
});

Deno.test("standards result is faithful (dry-run plan and applied steps)", async () => {
  await withTempDir(async (dir) => {
    await scaffoldEngine(dir);
    await gitInit(dir);
    await writeConfig(
      dir,
      [
        "[project]",
        'slug = "engine-test"',
        "",
        "[standards.coverage]",
        'run = "echo DISCERN_METRIC coverage 90"',
        'direction = "up"',
        "limit = 80",
        "",
      ].join("\n"),
    );
    await git(dir, "add", "-A");
    await git(dir, "commit", "-q", "-m", "add standard", "--no-gpg-sign");
    expectValid(
      DatalessEnvelopeSchema,
      await standardsResult(dir, { dryRun: true }),
      "standards dry-run",
    );
    expectFaithful(
      "standards",
      await standardsResult(dir, { dryRun: true }),
      "standards dry-run public schema",
    );
    const applied = await standardsResult(dir);
    assertEquals(applied.ok, true);
    expectFaithful("standards", applied, "standards applied");
  });
});

async function commitFiles(
  dir: string,
  files: Record<string, string>,
  message: string,
): Promise<void> {
  for (const [path, contents] of Object.entries(files)) {
    await Deno.writeTextFile(join(dir, path), contents);
  }
  await git(dir, "add", "-A");
  await git(dir, "commit", "-q", "-m", message, "--no-gpg-sign");
}

Deno.test("update result is faithful (dry-run prediction and applied data-bearing merge)", async () => {
  await withTempDir(async (dir) => {
    await scaffoldEngine(dir);
    await gitInit(dir);
    const wt = await addWorktree(dir, "int-schema");
    await commitFiles(dir, { "upstream.txt": "landed\n" }, "upstream");
    const ctx = await lifecycleContext(
      wt,
      new Logger({ json: true, noColor: true }),
    );

    const preview = await updateResult(ctx, { dryRun: true });
    assertEquals(preview.dry_run, true);
    assert(preview.data !== undefined, "update dry-run predicts data");
    assertEquals(preview.data.range.after, undefined);
    expectFaithful("update", preview, "update dry-run prediction");

    const applied = await updateResult(ctx);
    assertEquals(applied.ok, true);
    assert(applied.data !== undefined, "update apply carries data");
    assert(typeof applied.data.range.after === "string");
    expectFaithful("update", applied, "update applied");
  });
});

Deno.test("accept result is faithful (dry-run plan and applied gate-validation data)", async () => {
  await withTempDir(async (dir) => {
    await scaffoldEngine(dir);
    await writeConfig(
      dir,
      '[meta]\nbootstrapped = true\n\n[project]\nslug = "engine-test"\n',
    );
    await gitInit(dir);
    const wt = await addWorktree(dir, "grad");
    const ctx = await lifecycleContext(
      wt,
      new Logger({ json: true, noColor: true }),
    );
    const preview = await acceptResult(ctx, { dryRun: true });
    assertEquals(preview.dry_run, true);
    expectFaithful("accept", preview, "accept dry-run");
  });

  await withTempDir(async (dir) => {
    await scaffoldEngine(dir);
    await writeConfig(
      dir,
      '[meta]\nbootstrapped = true\n\n[project]\nslug = "engine-test"\n',
    );
    await gitInit(dir);
    const wt = await addWorktree(dir, "grad-rerun");
    await commitFiles(wt, { "feature.txt": "branch\n" }, "branch work");
    const ctx = await lifecycleContext(
      wt,
      new Logger({ json: true, noColor: true }),
    );
    const applied = await acceptResult(ctx, { confirmed: true });
    assertEquals(applied.ok, true);
    assertEquals(applied.data?.gate_validation?.mode, "rerun");
    expectFaithful("accept", applied, "accept applied rerun");
  });

  await withTempDir(async (dir) => {
    await scaffoldEngine(dir);
    await writeConfig(
      dir,
      '[meta]\nbootstrapped = true\n\n[project]\nslug = "engine-test"\n',
    );
    await gitInit(dir);
    const wt = await addWorktree(dir, "grad-receipt");
    await commitFiles(wt, { "feature.txt": "branch\n" }, "branch work");
    const finish = await finishResult(wt);
    assertEquals(finish.ok, true);
    const ctx = await lifecycleContext(
      wt,
      new Logger({ json: true, noColor: true }),
    );

    const applied = await acceptResult(ctx, { confirmed: true });
    assertEquals(applied.ok, true);
    assertEquals(applied.data?.gate_validation?.mode, "receipt");
    expectFaithful("accept", applied, "accept applied receipt");
  });
});

Deno.test("skills list result is faithful (bundled, authored override, and excluded rows)", async () => {
  await withTempDir(async (dir) => {
    await scaffoldEngine(dir);
    await gitInit(dir);
    const authored = async (name: string): Promise<void> => {
      await Deno.mkdir(join(dir, "skills", name), { recursive: true });
      await Deno.writeTextFile(
        join(dir, "skills", name, "SKILL.md"),
        `# ${name}\n`,
      );
    };
    await authored("my-own-skill");
    await authored("discern-write-adr"); // shadows the bundled built-in
    await writeConfig(
      dir,
      [
        "[project]",
        'slug = "engine-test"',
        "",
        "[skills]",
        'dir = "skills"',
        // One bundled and one authored exclusion, so the `excluded` flag is
        // exercised on both row sources.
        'exclude = ["discern-cure-a-bug", "my-own-skill"]',
        "",
      ].join("\n"),
    );

    const result = await skillsListResult(dir, await loadConfig(dir));
    // Every row arm at once — bundled, authored-only, authored override, and
    // excluded — must serialize to a shape the published contract accepts.
    expectFaithful("skillsList", result, "skills list");

    const rows = new Map((result.data?.skills ?? []).map((r) => [r.name, r]));
    assertEquals(rows.get("my-own-skill")?.hasBundled, false);
    assertEquals(rows.get("my-own-skill")?.excluded, true);
    assertEquals(rows.get("discern-write-adr")?.source, "authored");
    assertEquals(rows.get("discern-write-adr")?.overridesBundled, true);
    assertEquals(rows.get("discern-cure-a-bug")?.source, "bundled");
    assertEquals(rows.get("discern-cure-a-bug")?.excluded, true);
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
    expectFaithful("start", preview, "start dry-run");

    // applied: steps + data (the new worktree) + the re-root hint.
    const applied = await startResult(ctx, { worktreeRoot });
    assertEquals(applied.ok, true);
    expectFaithful("start", applied, "start applied");

    // named: the caller's name flows into the branch slug, and the normalisation is
    // surfaced through name_note (and stays schema-valid with the new field present).
    const named = await startResult(ctx, {
      worktreeRoot,
      name: "Fix the Upload Retry",
    });
    assertEquals(named.ok, true);
    expectFaithful("start", named, "start named");
    assert(
      named.data?.branch.includes("fix-the-upload-retry") ?? false,
      `named branch should carry the slug: ${named.data?.branch}`,
    );
    assert(
      named.data?.name_note?.includes("fix-the-upload-retry") ?? false,
      `expected a normalisation note: ${named.data?.name_note}`,
    );
  });
});

// Keep this test LAST in the file: it reconciles the declared covered set
// against the evidence the tests above accumulated while running. Deno runs a
// module's tests in registration order, so by the time this executes every
// faithfulness test has fired its expectFaithful calls.
Deno.test("FAITHFULNESS_COVERED is evidence-derived: it equals the ids expectFaithful exercised", () => {
  assertEquals(
    [...FAITHFULNESS_COVERED].sort(),
    [...FAITHFULNESS_EXERCISED].sort(),
    "FAITHFULNESS_COVERED must equal the contract ids exercised through " +
      "expectFaithful — enrol a contract by writing its faithfulness test, " +
      "never by editing the set",
  );
});
