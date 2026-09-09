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
import { isRepoMapPath, REPO_ROOT } from "./repo_authored_paths.ts";
import { structuralGuardScope } from "./structural_guard_scope.ts";
import { TEST_CLI_MODEL } from "./cli_model.ts";
import {
  addWorktree,
  defaultMapPath,
  git,
  gitInit,
  runAgent,
  scaffoldEngine,
  writeConfig,
} from "./engine_helpers.ts";
import { decodeCliResult } from "./decode_cli_result.ts";
import { awaitResult } from "../src/engine/await/await.ts";
import {
  type DiscernResult,
  ERROR_SLUGS,
  FAILED_STAGES,
  STEP_DISPOSITIONS,
  STEP_KINDS,
  STEP_OUTCOMES,
  stepResultFromJson,
  stepResultToJson,
  verbatimStepLabel,
} from "../src/shared/result.ts";
import { serializeResult } from "../src/shared/result_serialization.ts";
import { sha256Hex } from "../src/shared/sha256.ts";
import {
  ERROR_FAILURE_RECOVERY,
  ERRORLESS_FAILURE_RECOVERY,
  FAILURE_RECOVERY_EVIDENCE,
  failureRecoveryHintTexts,
  fire,
  hasRegisteredActionableHint,
  HINTS,
  hintTexts,
  withFailureRecoveryHint,
} from "../src/shared/hints.ts";
import {
  ACCEPT_LANDING_STATE_FIELDS,
  AcceptLandingStateSchema,
  AcceptOutputSchema,
  type CouplingData,
  DatalessEnvelopeSchema,
  EnvelopeSchema,
  GateDataSchema,
  StatusDataSchema,
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
import { testResult } from "../src/engine/gate/test_job.ts";
import { standardsResult } from "../src/engine/gate/standards.ts";
import { standardsProposeResult } from "../src/engine/gate/standard_proposals.ts";
import { doctorResult } from "../src/commands/doctor.ts";
import { impactResult } from "../src/engine/scopes/scopes.ts";
import { couplingResult } from "../src/engine/coupling/coupling.ts";
import { statusResult } from "../src/engine/status/status.ts";
import {
  patternsArchivesResult,
  patternsResetResult,
  patternsResult,
  patternsSealResult,
} from "../src/engine/logbook/patterns.ts";
import { improvementResult } from "../src/engine/improve/improve.ts";
import { checkpointsResult } from "../src/engine/checkpoints/report.ts";
import { reconcileOpenQuestion } from "../src/engine/checkpoints/open_questions.ts";
import { docsResult, mapResult } from "../src/commands/docs.ts";
import { refreshResult } from "../src/engine/instructions.ts";
import { tidyResult } from "../src/engine/tidy/tidy.ts";
import {
  acceptResult,
  type LifecycleContext,
  lifecycleContext,
  startResult,
  taskRenameResult,
  updateResult,
} from "../src/engine/worktree/lifecycle.ts";
import { resolveWorktreeRoot } from "../src/lib/paths.ts";
import { Logger } from "../src/lib/log.ts";
import { removeWorktreeSafely } from "../src/engine/worktree/git.ts";
import { SCHEMA_VERSION } from "../src/lib/version.ts";

const RETIRED_STATUS_REFRESH_FIELDS = [
  "stale_generated",
  "stale_materialized",
  "stale_integrations",
  "stale_adr_index",
] as const;

Deno.test("status keeps one canonical refresh projection", async () => {
  const schemaFields = new Set(Object.keys(StatusDataSchema.shape));
  const implementationPaths = await structuralGuardScope({
    guard: "tests/result_schemas_test.ts#retired-status-refresh-fields",
    universe: "authored-ts",
    narrow: {
      reason:
        "Only the status core and its MCP adapter can project status refresh fields onto the public result.",
      include: (path) =>
        path === "src/engine/status/status.ts" ||
        path === "src/engine/mcp/server.ts",
    },
  });
  const implementation = await Promise.all(
    implementationPaths.map(async (path) => ({
      path,
      text: await Deno.readTextFile(join(REPO_ROOT, path)),
    })),
  );
  const offenders: string[] = [];
  for (const field of RETIRED_STATUS_REFRESH_FIELDS) {
    if (schemaFields.has(field)) offenders.push(`schema: ${field}`);
    for (const source of implementation) {
      if (source.text.includes(field)) {
        offenders.push(`${source.path}: ${field}`);
      }
    }
  }
  assertEquals(offenders, []);
  assert(schemaFields.has("pending_tracked_refresh"));
  assert(schemaFields.has("tracked_refresh_plan_errors"));
});

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

/** Validate a real verb result against the PUBLISHED schema of the contract it
 * claims — looked up in the registry, so the id and the schema cannot be
 * mismatched. */
function validateFaithful(
  contractId: string,
  result: DiscernResult,
  label: string,
): void {
  validateSerializedFaithful(
    contractId,
    serializeResult(result),
    label,
  );
}

/** Validate an already serialized real CLI envelope against its contract. */
function validateSerializedFaithful(
  contractId: string,
  serialized: unknown,
  label: string,
): void {
  const contract = CLI_JSON_RESULT_CONTRACTS.find((c) => c.id === contractId);
  assert(
    contract !== undefined,
    `validateFaithful("${contractId}") names no published contract`,
  );
  const parsed = contract.schema.safeParse(serialized);
  assert(
    parsed.success,
    `${label} drifted from its schema:\n${
      JSON.stringify(parsed.success ? [] : parsed.error.issues, null, 2)
    }\n--- serialized result ---\n${JSON.stringify(serialized, null, 2)}`,
  );
}

interface FaithfulnessAssertions {
  /** Validate a real core result and record the contract in this case only. */
  readonly expectFaithful: (
    contractId: string,
    result: DiscernResult,
    label: string,
  ) => void;
  /** Validate a serialized CLI result and record the contract in this case only. */
  readonly expectSerializedFaithful: (
    contractId: string,
    serialized: unknown,
    label: string,
  ) => void;
}

interface FaithfulnessCase {
  /** Stable test name shown by Deno. */
  readonly name: string;
  /** Contracts this case declares it exercises. */
  readonly contractIds: readonly string[];
  /** Real result exercises for the declared contracts. */
  readonly run: (
    assertions: FaithfulnessAssertions,
  ) => void | Promise<void>;
}

/** Declare one faithfulness case without registering or executing it yet. */
function defineFaithfulnessCase(
  name: string,
  contractIds: readonly string[],
): (
  run: FaithfulnessCase["run"],
) => FaithfulnessCase {
  return (run) => ({ name, contractIds, run });
}

Deno.test("envelope schema is locked to serializeResult's wire shape", async () => {
  // The maximal valid applied and preview variants collectively populate every
  // envelope field. If serialization or the schema grows alone, the key-set
  // equality below fails without constructing a contradictory state.
  const maximalApplied: DiscernResult = {
    ok: false,
    verb: "demo",
    steps: [{
      step: {
        kind: "job",
        label: verbatimStepLabel("l"),
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
    waitedMs: 123,
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
    advisories: [{
      kind: "doctor-warning",
      evidence: ["A non-blocking check needs attention."],
      next_action: "Review the check before relying on it.",
    }],
    hints: hintTexts([fire(HINTS["failure-recovery"], { verb: "demo" })]),
    error: "internal_error",
    message: "msg",
  };
  const maximalPreview: DiscernResult = {
    ok: true,
    verb: "demo",
    dry_run: true,
    plan: {
      title: "Plan",
      details: ["detail"],
      steps: [{
        kind: "job",
        label: verbatimStepLabel("l"),
        disposition: "run",
        note: "n",
        group: "g",
      }],
    },
  };
  const diagnosticBytes = JSON.stringify(maximalApplied.diagnostics);
  maximalApplied.diagnosticEvidence = {
    raw: diagnosticBytes,
    path: "/tmp/discern-diag-demo-evidence.log",
    digest: await sha256Hex(diagnosticBytes),
    bytes: new TextEncoder().encode(diagnosticBytes).length,
  };
  const serializedApplied = serializeResult(maximalApplied);
  const serializedPreview = serializeResult(maximalPreview);
  expectValid(EnvelopeSchema, maximalApplied, "maximal applied envelope");
  expectValid(EnvelopeSchema, maximalPreview, "maximal preview envelope");
  // Every key serializeResult emits is one the envelope schema declares (and vice
  // versa) — so neither side can grow a field the other doesn't know about.
  const schemaKeys = Object.keys(EnvelopeSchema.shape).sort();
  assertEquals(
    Object.keys({ ...serializedApplied, ...serializedPreview }).sort(),
    schemaKeys,
  );
});

Deno.test("contradictory result states are compile-time and runtime errors", () => {
  const plan = {
    title: "Future plan",
    details: [],
    steps: [],
  };
  const steps = [{
    step: {
      kind: "job" as const,
      label: verbatimStepLabel("future-step"),
      disposition: "run" as const,
    },
    outcome: "ok" as const,
  }];

  const successWithError: DiscernResult = {
    ok: true,
    verb: "future-orbit",
    // @ts-expect-error A successful result cannot carry a failure slug.
    error: "internal_error",
  };
  // @ts-expect-error A result cannot carry both planned and completed steps.
  const planWithSteps: DiscernResult = {
    ok: false,
    verb: "future-orbit",
    plan,
    steps,
  };
  // @ts-expect-error A preview cannot report completed steps.
  const previewWithSteps: DiscernResult = {
    ok: false,
    verb: "future-orbit",
    dry_run: true,
    steps,
  };
  void successWithError;
  void planWithSteps;
  void previewWithSteps;

  for (
    const contradictory of [
      {
        ok: true,
        verb: "future-orbit",
        error: "internal_error",
      },
      { ok: false, verb: "future-orbit", plan, steps },
      { ok: false, verb: "future-orbit", dry_run: true, steps },
    ]
  ) {
    assert(
      !EnvelopeSchema.safeParse(contradictory).success,
      `EnvelopeSchema accepted ${JSON.stringify(contradictory)}`,
    );
  }

  assert(
    EnvelopeSchema.safeParse({ ok: false, verb: "future-orbit" }).success,
    "an applied failure may omit an error slug",
  );
  assert(
    EnvelopeSchema.safeParse({ ok: false, verb: "future-orbit", plan })
      .success,
    "a refusal may carry a review plan without claiming dry-run",
  );
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

Deno.test("every canonical error family is enrolled in evidence-backed or tailored recovery", () => {
  assertEquals(
    Object.keys(ERROR_FAILURE_RECOVERY).sort(),
    [...ERROR_SLUGS].sort(),
    "a new error slug needs an explicit recovery classification",
  );
  const tailored = hintTexts([fire(HINTS["unknown-command-help"])]);

  for (const error of ERROR_SLUGS) {
    const failure = {
      ok: false,
      verb: "demo",
      error,
      message: "The reported condition names its correction.",
    } satisfies DiscernResult;
    const prepared = withFailureRecoveryHint(failure);
    if (ERROR_FAILURE_RECOVERY[error] === "evidence") {
      assert(
        hasRegisteredActionableHint(prepared.hints),
        `${error}: audited evidence families receive the generic floor`,
      );
      serializeResult(prepared);
    } else {
      assertEquals(
        prepared,
        failure,
        `${error}: tailored families must not receive the generic floor`,
      );
      assertThrows(
        () =>
          serializeResult({
            ...failure,
            hints: failureRecoveryHintTexts("demo"),
          }),
        Error,
        "requires a tailored registered next-step hint",
      );
      serializeResult({ ...failure, hints: tailored });
    }
  }

  const errorlessWithEvidence = {
    ok: false,
    verb: "demo",
    message: "No canonical error family identifies this failure.",
  } satisfies DiscernResult;
  assertEquals(ERRORLESS_FAILURE_RECOVERY, "evidence");
  const preparedErrorless = withFailureRecoveryHint(errorlessWithEvidence);
  assert(
    hasRegisteredActionableHint(preparedErrorless.hints),
    "an error-less applied failure with corrective evidence receives the generic floor",
  );
  serializeResult(preparedErrorless);

  const errorlessDataOnly = {
    ok: false,
    verb: "demo",
    data: { state: "failed" },
  } satisfies DiscernResult;
  assertEquals(
    withFailureRecoveryHint(errorlessDataOnly),
    errorlessDataOnly,
    "an error-less data-only failure must not receive a fabricated fallback",
  );
  assertThrows(
    () => serializeResult(errorlessDataOnly),
    Error,
    "has no registered next-step hint",
  );
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

Deno.test("canonical error slugs stay sorted and exclude retired synonyms", () => {
  assertEquals(
    [...ERROR_SLUGS],
    [...ERROR_SLUGS].sort(),
    "the published error vocabulary must stay alphabetically stable",
  );
  const retiredSynonyms = {
    dirty_tree: "dirty_worktree",
    no_project: "not_initialized",
    not_setup_branch: "not_on_setup_branch",
    uncommitted_changes: "dirty_worktree",
  } as const;
  for (const [retired, canonical] of Object.entries(retiredSynonyms)) {
    assert(
      !(ERROR_SLUGS as readonly string[]).includes(retired),
      `${retired} duplicates canonical slug ${canonical}`,
    );
    assert(
      (ERROR_SLUGS as readonly string[]).includes(canonical),
      `${canonical} must remain the canonical replacement for ${retired}`,
    );
  }
});

Deno.test("accept's partial envelope carries the exact irreversible effect state", () => {
  const partial = {
    ok: false,
    verb: "accept",
    error: "partial_acceptance",
    message: "The trunk landed, but cleanup did not finish.",
    hints: hintTexts([fire(HINTS["accept-reconcile-partial-effects"])]),
    data: {
      root: "/repo",
      consent: { source: "conversation" },
      landing: {
        recovery_performed: false,
        trunk_landed: true,
        worktree_removed: true,
        branch_deleted: false,
      },
    },
  } satisfies DiscernResult;
  assert(
    AcceptOutputSchema.safeParse(serializeResult(partial)).success,
    "an accept failure after irreversible effects must retain typed landing state",
  );
  assertEquals(
    Object.keys(partial.data.landing),
    ACCEPT_LANDING_STATE_FIELDS,
    "the partial fixture must enroll every canonical landing-state field",
  );
  assertEquals(
    Object.keys(AcceptLandingStateSchema.shape),
    ACCEPT_LANDING_STATE_FIELDS,
  );
});

Deno.test("every canonical error slug has a production source anchor", async () => {
  const errorSourceFiles = await structuralGuardScope({
    guard: "tests/result_schemas_test.ts#error-slug-source-anchors",
    universe: "authored-ts",
    narrow: {
      reason:
        "Public error slugs require production emission anchors; the result registry is the vocabulary authority, not an emitter.",
      include: (rel) =>
        rel.startsWith("src/") && rel !== "src/shared/result.ts",
    },
  });
  const sources = await Promise.all(
    errorSourceFiles.map((rel) => Deno.readTextFile(join(REPO_ROOT, rel))),
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
// test here ever ran it. FAITHFULNESS_CASES is the declaration both the real
// result tests and these audits iterate. Each case also reconciles its declared
// ids against its own calls, so an id cannot be enrolled without that same test
// exercising it, and no evidence crosses a Deno.test boundary.

/** Published contracts awaiting a real-result faithfulness case. */
const FAITHFULNESS_DEBT = new Set<string>();

Deno.test("the public result registry carries no faithfulness debt", () => {
  assertEquals(FAITHFULNESS_DEBT.size, 0);
});

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

const ROOT_COMMANDS_FAITHFULNESS_CASE = defineFaithfulnessCase(
  "root, utility, read, and command-group CLI results are faithful",
  [
    "root",
    "help",
    "licenses",
    "triangle",
    "scripts",
    "desk",
    "enter",
    "worktree",
    "worktreeEnsure",
    "skills",
    "config",
    "identity",
  ],
)(async ({ expectSerializedFaithful }) => {
  await withTempDir(async (dir) => {
    await scaffoldEngine(dir);
    await gitInit(dir);

    const cases = [
      { id: "root", args: ["--json"] },
      {
        id: "help",
        args: ["help", "worktree", "ensure", "--json"],
      },
      { id: "licenses", args: ["licenses", "--json"] },
      { id: "triangle", args: ["triangle", "--json"] },
      { id: "scripts", args: ["scripts", "--json"] },
      { id: "desk", args: ["desk", "--json"] },
      { id: "enter", args: ["enter", "--json"] },
      { id: "worktree", args: ["worktree", "--json"] },
      {
        id: "worktreeEnsure",
        args: ["worktree", "ensure", "--json"],
      },
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
      const command = testCase.id === "root"
        ? "discern"
        : testCase.id === "config"
        ? `config ${testCase.args[1]}`
        : testCase.id === "worktreeEnsure"
        ? "worktree ensure"
        : testCase.id;
      const envelope = decodeCliResult(result.stdout, command);
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
      decodeCliResult(identity.stdout, "identity"),
      "identity --port --json",
    );
  });
});

const SETUP_MAINTENANCE_FAITHFULNESS_CASE = defineFaithfulnessCase(
  "setup, maintenance, and worktree lifecycle refusals are faithful before initialization",
  [
    "setup",
    "setupBegin",
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
  ],
)(async ({ expectSerializedFaithful }) => {
  await withTempDir(async (dir) => {
    await Deno.writeTextFile(`${dir}/README.md`, "fixture\n");
    await gitInit(dir);
    const cases = [
      { id: "setup", command: "setup", args: ["setup", "--json"] },
      {
        id: "setupBegin",
        command: "setup begin",
        args: ["setup", "begin", "--json"],
      },
      {
        id: "setupDone",
        command: "setup done",
        args: ["setup", "done", "--json"],
      },
      {
        id: "setupAccept",
        command: "setup accept",
        args: ["setup", "accept", "--dry-run", "--json"],
      },
      {
        id: "setupStep",
        command: "setup step",
        args: ["setup", "step", "1", "--json"],
      },
      {
        id: "setupVerify",
        command: "setup verify",
        args: ["setup", "verify", "--json"],
      },
      {
        id: "skillsEject",
        command: "skills eject",
        args: ["skills", "eject", "discern-write-adr", "--json"],
      },
      {
        id: "uninstall",
        command: "uninstall",
        args: ["uninstall", "--dry-run", "--json"],
      },
      {
        id: "upgrade",
        command: "upgrade",
        args: ["upgrade", "--check", "--json"],
      },
      {
        id: "worktreeDrop",
        command: "worktree drop",
        args: ["worktree", "drop", "missing", "--json"],
      },
      {
        id: "worktreePrune",
        command: "worktree prune",
        args: ["worktree", "prune", "--dry-run", "--json"],
      },
      {
        id: "worktreeSetup",
        command: "worktree setup",
        args: ["worktree", "setup", "--json"],
      },
      {
        id: "worktreeTeardown",
        command: "worktree teardown",
        args: ["worktree", "teardown", "--json"],
      },
    ] as const;

    for (const testCase of cases) {
      const result = await runAgent(dir, [...testCase.args]);
      expectSerializedFaithful(
        testCase.id,
        decodeCliResult(result.stdout, testCase.command),
        testCase.args.join(" "),
      );
    }
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
    ...await structuralGuardScope({
      guard: "tests/result_schemas_test.ts#current-facing-source-outcomes",
      universe: "authored-ts",
      narrow: {
        reason:
          "Current-facing product prose lives outside tests, whose fixtures intentionally describe invalid outcome wording.",
        include: (rel) => !rel.startsWith("tests/"),
      },
    }),
    ...await structuralGuardScope({
      guard: "tests/result_schemas_test.ts#current-facing-markdown-outcomes",
      universe: "tracked-markdown",
      narrow: {
        reason:
          "Accepted decisions and private planning are historical records; current-facing Markdown must preserve the live outcome distinction.",
        include: (rel) =>
          !isRepoMapPath(rel, "_adr") && !isRepoMapPath(rel, "_private"),
      },
    }),
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

const DONE_FAITHFULNESS_CASE = defineFaithfulnessCase(
  "done result is faithful to FinishOutputSchema (preview, clean, failing)",
  ["done"],
)(async ({ expectFaithful }) => {
  await withTempDir(async (dir) => {
    await scaffoldEngine(dir);
    await gitInit(dir);

    expectFaithful(
      "done",
      await finishResult(dir, {
        surface: { kind: "quiet" },
        cliModel: TEST_CLI_MODEL,
        dryRun: true,
      }),
      "finish dry-run",
    );
    expectFaithful(
      "done",
      await finishResult(dir, {
        surface: { kind: "quiet" },
        cliModel: TEST_CLI_MODEL,
      }),
      "finish clean",
    );

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
    const failing = await finishResult(dir, {
      standalone: true,
      surface: { kind: "quiet" },
      cliModel: TEST_CLI_MODEL,
    });
    assertEquals(failing.ok, false);
    expectFaithful("done", failing, "finish failing");
  });
});

const PREPARE_TEST_FAITHFULNESS_CASE = defineFaithfulnessCase(
  "prepare/test results are faithful (clean and failing)",
  ["prepare", "test"],
)(async ({ expectFaithful }) => {
  await withTempDir(async (dir) => {
    await scaffoldEngine(dir);
    await gitInit(dir);
    // Public schemas carry producer counts without granting completion evidence.
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

const REFRESH_FAITHFULNESS_CASE = defineFaithfulnessCase(
  "refresh result is faithful to RefreshOutputSchema (clean and partial)",
  ["refresh"],
)(async ({ expectFaithful }) => {
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

const TIDY_FAITHFULNESS_CASE = defineFaithfulnessCase(
  "tidy result is faithful in preview and apply modes",
  ["tidy"],
)(async ({ expectFaithful }) => {
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

const DOCTOR_FAITHFULNESS_CASE = defineFaithfulnessCase(
  "doctor result is faithful (healthy and failing)",
  ["doctor"],
)(async ({ expectFaithful }) => {
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

const DOCTOR_EXECUTION_MODEL_FAITHFULNESS_CASE = defineFaithfulnessCase(
  "doctor execution_model is faithful across a rich config (resources, standards, scopes)",
  ["doctor"],
)(async ({ expectFaithful }) => {
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
    const result = await doctorResult(dir, { verbose: true });
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

const IMPACT_FAITHFULNESS_CASE = defineFaithfulnessCase(
  "impact result is faithful",
  ["impact"],
)(async ({ expectFaithful }) => {
  await withTempDir(async (dir) => {
    await scaffoldEngine(dir);
    await gitInit(dir);
    expectFaithful("impact", await impactResult(dir), "impact");
  });
});

const COUPLING_FAITHFULNESS_CASE = defineFaithfulnessCase(
  "coupling result is faithful (diff-aware, query, and a real partner edge)",
  ["coupling"],
)(async ({ expectFaithful }) => {
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

const AWAIT_FAITHFULNESS_CASE = defineFaithfulnessCase(
  "await result is faithful (refusals, not-yet, and both met shapes)",
  ["await"],
)(async ({ expectFaithful }) => {
  await withTempDir(async (dir) => {
    await scaffoldEngine(dir);
    await gitInit(dir);

    // Refusals: no condition, and a branch that cannot be pinned.
    expectFaithful("await", await awaitResult(dir, {}), "await no condition");
    expectFaithful(
      "await",
      await awaitResult(dir, { landed: "agent/zz-absent", timeoutSeconds: 0 }),
      "await missing branch",
    );

    // Not-yet: the timeout envelope with retry advice (ok stays true).
    const notYet = await awaitResult(dir, {
      trunkMoved: true,
      timeoutSeconds: 0,
    });
    expectFaithful("await", notYet, "await not-yet");
    assert(notYet.ok && notYet.data?.met === false);

    // Met via complete current evidence from the public gate.
    const dep = await addWorktree(dir, "await-dep");
    await Deno.writeTextFile(join(dep, "dep.txt"), "work");
    await git(dep, "add", "-A");
    await git(dep, "commit", "-q", "-m", "dep work", "--no-gpg-sign");
    const finished = await finishResult(dep, {
      surface: { kind: "quiet" },
      cliModel: TEST_CLI_MODEL,
    });
    assert(finished.ok, JSON.stringify(finished));
    const green = await awaitResult(dir, {
      green: "agent/await-dep",
      timeoutSeconds: 0,
    });
    expectFaithful("await", green, "await green met");
    assert(green.ok && green.data?.met === true);

    // Met via landing: retain the transition across the merge, and validate
    // the overlap-preview fields too.
    const landingWatch = await awaitResult(dir, {
      landed: "agent/await-dep",
      timeoutSeconds: 0,
    });
    assert(landingWatch.ok && landingWatch.data?.met === false);
    const resume = landingWatch.data?.resume;
    assert(typeof resume === "string");
    await git(dir, "merge", "-q", "agent/await-dep");
    const landed = await awaitResult(dir, {
      resume,
      timeoutSeconds: 0,
    });
    expectFaithful("await", landed, "await landed met");
    assert(landed.ok && landed.data?.met === true);
  });
});

const PATTERNS_FAITHFULNESS_CASE = defineFaithfulnessCase(
  "patterns result and its reset are faithful (empty, seeded, dry-run, applied)",
  ["patterns", "patternsReset", "patternsSeal", "patternsArchives"],
)(async ({ expectFaithful }) => {
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
    expectFaithful(
      "patternsSeal",
      await patternsSealResult(dir, { dryRun: true }),
      "patterns seal dry-run",
    );
    expectFaithful(
      "patternsSeal",
      await patternsSealResult(dir),
      "patterns seal refusal",
    );
    expectFaithful(
      "patternsArchives",
      await patternsArchivesResult(dir),
      "patterns archives",
    );
  });
});

const STATUS_FAITHFULNESS_CASE = defineFaithfulnessCase(
  "status result is faithful across modes (main, fleet, worktree, unset-up)",
  ["status"],
)(async ({ expectFaithful }) => {
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

    // A program writes into a path after the worktree removal. This exercises
    // the reappearance evidence on the same schema the MCP output advertises.
    const retiredPath = await Deno.realPath(wt);
    await removeWorktreeSafely(wt, dir);
    await Deno.mkdir(join(wt, "observer-state"), { recursive: true });
    await Deno.writeTextFile(
      join(wt, "observer-state", "checkpoint.bin"),
      "state\n",
    );
    const reappeared = await statusResult(dir);
    assertEquals(
      reappeared.data?.reappeared_worktree_paths?.map((entry) => entry.path),
      [retiredPath],
    );
    expectFaithful("status", reappeared, "status reappeared worktree path");
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

const IMPROVEMENT_FAITHFULNESS_CASE = defineFaithfulnessCase(
  "improvement result is faithful (full, category, below-min, unknown)",
  ["improvement"],
)(async ({ expectFaithful }) => {
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

const CHECKPOINTS_FAITHFULNESS_CASE = defineFaithfulnessCase(
  "checkpoints result is faithful (empty, fired, ungoverned open question)",
  ["checkpoints"],
)(async ({ expectFaithful }) => {
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
        "[checkpoints.api-review]",
        'paths = ["api/**"]',
        'question = "A changed API surface is described in its docs."',
        "",
      ].join("\n"),
    );
    await gitInit(dir);
    expectFaithful(
      "checkpoints",
      await checkpointsResult(dir),
      "checkpoints idle",
    );
    // An uncommitted matching change makes the trigger hold (fired preview).
    await Deno.mkdir(join(dir, "api"), { recursive: true });
    await Deno.writeTextFile(join(dir, "api", "surface.txt"), "endpoint\n");
    const fired = await checkpointsResult(dir);
    assertEquals(fired.data?.checkpoints[0]?.preview?.holds, true);
    expectFaithful("checkpoints", fired, "checkpoints fired");
    // A recorded open question outside the governing policy rides the optional block.
    const planted = await reconcileOpenQuestion(dir, {
      checkpoint: "ghost",
      definitionHash: "d".repeat(64),
      subject: "s".repeat(64),
      matchedPaths: ["api/surface.txt"],
      relatedPaths: [],
    });
    assert(planted.ok, "the fixture open question must record");
    const withGhost = await checkpointsResult(dir);
    assertEquals(withGhost.data?.ungoverned?.length, 1);
    expectFaithful("checkpoints", withGhost, "checkpoints ungoverned");
  });
});

const MAP_DOCS_FAITHFULNESS_CASE = defineFaithfulnessCase(
  "map/docs results are faithful (index, single doc, not-found, no-tree)",
  ["map", "docs"],
)(async ({ expectFaithful }) => {
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

    // docs reads discern's OWN bundled docs (always present in this repo's build).
    expectFaithful("docs", await docsResult(dir), "docs index");
    expectFaithful(
      "docs",
      await docsResult(dir, { target: "config-reference" }),
      "docs single",
    );
    expectFaithful(
      "docs",
      await docsResult(dir, { target: "no-such-doc" }),
      "docs not-found",
    );
    expectFaithful(
      "docs",
      await docsResult(dir, { search: "worktree resources" }),
      "docs search",
    );
  });
});

const STANDARDS_FAITHFULNESS_CASE = defineFaithfulnessCase(
  "standards result is faithful (dry-run plan and applied steps)",
  ["standards"],
)(async ({ expectFaithful }) => {
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

const STANDARDS_PROPOSE_FAITHFULNESS_CASE = defineFaithfulnessCase(
  "standards propose result is faithful (preview and recorded proposal)",
  ["standardsPropose"],
)(async ({ expectFaithful }) => {
  await withTempDir(async (dir) => {
    await scaffoldEngine(dir);
    await writeConfig(
      dir,
      [
        "[project]",
        'slug = "proposal-faithfulness"',
        "",
        "[repository]",
        'trunk = "main"',
        "",
        "[standards.sources]",
        'direction = "down"',
        "limit = 1",
        "run = \"count=$(git ls-files 'src/**' | wc -l); echo DISCERN_METRIC sources $count\"",
        'inputs = ["src/**"]',
        "",
      ].join("\n"),
    );
    await Deno.mkdir(join(dir, "src"), { recursive: true });
    await Deno.writeTextFile(join(dir, "src", "base.ts"), "base\n");
    await gitInit(dir);
    const worktree = await addWorktree(dir, "proposal-faithfulness");
    await Deno.writeTextFile(join(worktree, "src", "feature.ts"), "feature\n");
    await git(worktree, "add", "src/feature.ts");
    await git(worktree, "commit", "-m", "Add feature source");

    const preview = await standardsProposeResult(worktree, {
      name: "sources",
      reason: "The feature adds one required source.",
      dryRun: true,
    });
    expectFaithful("standardsPropose", preview, "standards propose preview");

    const applied = await standardsProposeResult(worktree, {
      name: "sources",
      reason: "The feature adds one required source.",
    });
    assertEquals(applied.ok, true);
    expectFaithful("standardsPropose", applied, "standards propose applied");
  });
});

/** Materialize and commit a chosen integration change set for lifecycle schema cases. */
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

const UPDATE_FAITHFULNESS_CASE = defineFaithfulnessCase(
  "update result is faithful (dry-run prediction and applied data-bearing merge)",
  ["update"],
)(async ({ expectFaithful }) => {
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

const ACCEPT_FAITHFULNESS_CASE = defineFaithfulnessCase(
  "accept result is faithful (dry-run plan and complete per-prefix landing data)",
  ["accept"],
)(async ({ expectFaithful }) => {
  await withTempDir(async (dir) => {
    await scaffoldEngine(dir);
    await writeConfig(
      dir,
      `[meta]\nschema_version = ${SCHEMA_VERSION}\nbootstrapped = true\n\n[project]\nslug = "engine-test"\n`,
    );
    await gitInit(dir);
    const wt = await addWorktree(dir, "grad");
    const ctx = await lifecycleContext(
      wt,
      new Logger({ json: true, noColor: true }),
    );
    const preview = await acceptResult(ctx, {
      dryRun: true,
      cliModel: TEST_CLI_MODEL,
    });
    assertEquals(preview.dry_run, true);
    expectFaithful("accept", preview, "accept dry-run");
  });

  await withTempDir(async (dir) => {
    await scaffoldEngine(dir);
    await writeConfig(
      dir,
      `[meta]\nschema_version = ${SCHEMA_VERSION}\nbootstrapped = true\n\n[project]\nslug = "engine-test"\n`,
    );
    await gitInit(dir);
    const wt = await addWorktree(dir, "grad-rerun");
    await commitFiles(wt, { "feature.txt": "branch\n" }, "branch work");
    const finish = await finishResult(wt, {
      surface: { kind: "quiet" },
      cliModel: TEST_CLI_MODEL,
    });
    assert(finish.ok, JSON.stringify(finish));
    const ctx = await lifecycleContext(
      wt,
      new Logger({ json: true, noColor: true }),
    );
    const applied = await acceptResult(ctx, {
      confirmed: true,
      cliModel: TEST_CLI_MODEL,
    });
    assertEquals(applied.ok, true);
    const prefix = applied.data?.queue?.[0];
    assertEquals(prefix?.state, "landed");
    assertEquals(prefix?.convergence, "passed");
    assertEquals(prefix?.retirement, "retired");
    assertEquals(prefix?.retirement_effects, {
      worktree_removed: true,
      branch_deleted: true,
    });
    // One landing carries the complete per-prefix data: the applied envelope
    // after a real Proof, with every landing, convergence, and retirement fact.
    expectFaithful("accept", applied, "accept applied proof");
  });
});

const SKILLS_LIST_FAITHFULNESS_CASE = defineFaithfulnessCase(
  "skills list result is faithful (bundled, authored override, and excluded rows)",
  ["skillsList"],
)(async ({ expectFaithful }) => {
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
    assertEquals(rows.get("my-own-skill")?.has_bundled, false);
    assertEquals(rows.get("my-own-skill")?.excluded, true);
    assertEquals(rows.get("discern-write-adr")?.source, "authored");
    assertEquals(rows.get("discern-write-adr")?.overrides_bundled, true);
    assertEquals(rows.get("discern-cure-a-bug")?.source, "bundled");
    assertEquals(rows.get("discern-cure-a-bug")?.excluded, true);
  });
});

const START_FAITHFULNESS_CASE = defineFaithfulnessCase(
  "start result is faithful (dry-run preview and applied worktree)",
  ["start"],
)(async ({ expectFaithful }) => {
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

/** Start one named task for result-faithfulness lifecycle cases. */
async function startedFaithfulnessFixture(
  dir: string,
  name: string,
  brief: string,
): Promise<{ path: string; worktree: LifecycleContext }> {
  await scaffoldEngine(dir);
  await gitInit(dir);
  const main = await lifecycleContext(
    dir,
    new Logger({ json: true, noColor: true }),
  );
  const started = await startResult(main, {
    worktreeRoot: resolveWorktreeRoot(main.root, main.config),
    name,
    brief,
  });
  const path = started.data?.path;
  assert(path !== undefined);
  return {
    path,
    worktree: await lifecycleContext(
      path,
      new Logger({ json: true, noColor: true }),
    ),
  };
}

const TASK_RENAME_FAITHFULNESS_CASE = defineFaithfulnessCase(
  "worktree rename result is faithful (preview and applied Unicode title)",
  ["worktreeRename"],
)(async ({ expectFaithful }) => {
  await withTempDir(async (dir) => {
    const { worktree } = await startedFaithfulnessFixture(
      dir,
      "rename-faithfulness",
      "Keep the brief intact.",
    );

    const preview = await taskRenameResult(
      worktree,
      "題名を保つ: Café ✓",
      { dryRun: true },
    );
    expectFaithful("worktreeRename", preview, "worktree rename dry-run");

    const applied = await taskRenameResult(
      worktree,
      "題名を保つ: Café ✓",
    );
    expectFaithful("worktreeRename", applied, "worktree rename applied");
    assertEquals(applied.data?.task.brief, "Keep the brief intact.");
  });
});

const WORKTREE_PARK_FAITHFULNESS_CASE = defineFaithfulnessCase(
  "worktree park result is faithful (preview and applied)",
  ["worktreePark"],
)(async ({ expectSerializedFaithful }) => {
  await withTempDir(async (dir) => {
    const { path } = await startedFaithfulnessFixture(
      dir,
      "park-faithfulness",
      "Retain the task wording.",
    );
    await git(path, "add", "-A");
    await git(path, "commit", "-m", "Prepare Park faithfulness fixture");

    const preview = await runAgent(dir, [
      "worktree",
      "park",
      path,
      "--dry-run",
      "--json",
    ]);
    assertEquals(preview.code, 0, preview.output);
    expectSerializedFaithful(
      "worktreePark",
      decodeCliResult(preview.stdout, "worktree park"),
      "worktree park dry-run",
    );

    const applied = await runAgent(dir, [
      "worktree",
      "park",
      path,
      "--json",
    ]);
    assertEquals(applied.code, 0, applied.output);
    expectSerializedFaithful(
      "worktreePark",
      decodeCliResult(applied.stdout, "worktree park"),
      "worktree park applied",
    );
  });
});

/**
 * The declaration every faithfulness test and coverage audit consumes. A new
 * case is registered by the loop below and enrolled in FAITHFULNESS_COVERED by
 * the same entry; each running case reconciles only its own local calls.
 */
const FAITHFULNESS_CASES: readonly FaithfulnessCase[] = [
  ROOT_COMMANDS_FAITHFULNESS_CASE,
  SETUP_MAINTENANCE_FAITHFULNESS_CASE,
  DONE_FAITHFULNESS_CASE,
  PREPARE_TEST_FAITHFULNESS_CASE,
  REFRESH_FAITHFULNESS_CASE,
  TIDY_FAITHFULNESS_CASE,
  DOCTOR_FAITHFULNESS_CASE,
  DOCTOR_EXECUTION_MODEL_FAITHFULNESS_CASE,
  IMPACT_FAITHFULNESS_CASE,
  COUPLING_FAITHFULNESS_CASE,
  AWAIT_FAITHFULNESS_CASE,
  PATTERNS_FAITHFULNESS_CASE,
  STATUS_FAITHFULNESS_CASE,
  IMPROVEMENT_FAITHFULNESS_CASE,
  CHECKPOINTS_FAITHFULNESS_CASE,
  MAP_DOCS_FAITHFULNESS_CASE,
  STANDARDS_FAITHFULNESS_CASE,
  STANDARDS_PROPOSE_FAITHFULNESS_CASE,
  UPDATE_FAITHFULNESS_CASE,
  ACCEPT_FAITHFULNESS_CASE,
  SKILLS_LIST_FAITHFULNESS_CASE,
  START_FAITHFULNESS_CASE,
  TASK_RENAME_FAITHFULNESS_CASE,
  WORKTREE_PARK_FAITHFULNESS_CASE,
];

/** Contract ids backed by declared, self-reconciling real-result cases. */
const FAITHFULNESS_COVERED = new Set(
  FAITHFULNESS_CASES.flatMap((testCase) => testCase.contractIds),
);

for (const testCase of FAITHFULNESS_CASES) {
  Deno.test(testCase.name, async () => {
    const declaredIds: readonly string[] = testCase.contractIds;
    const exercised = new Set<string>();
    const record = (contractId: string): void => {
      assert(
        declaredIds.includes(contractId),
        `${testCase.name} exercised undeclared contract "${contractId}"`,
      );
      exercised.add(contractId);
    };
    const assertions: FaithfulnessAssertions = {
      expectFaithful: (contractId, result, label) => {
        record(contractId);
        validateFaithful(contractId, result, label);
      },
      expectSerializedFaithful: (contractId, serialized, label) => {
        record(contractId);
        validateSerializedFaithful(contractId, serialized, label);
      },
    };

    await testCase.run(assertions);
    assertEquals(
      [...exercised].sort(),
      [...new Set(declaredIds)].sort(),
      `${testCase.name} must exercise every contract it declares`,
    );
  });
}

Deno.test("faithfulness case declarations are unique within their own authority", () => {
  assertEquals(
    new Set(FAITHFULNESS_CASES.map((testCase) => testCase.name)).size,
    FAITHFULNESS_CASES.length,
    "faithfulness case names must be unique",
  );
  for (const testCase of FAITHFULNESS_CASES) {
    assertEquals(
      new Set(testCase.contractIds).size,
      testCase.contractIds.length,
      `${testCase.name} declares a contract more than once`,
    );
  }
});

Deno.test("retained step projection preserves outcomes, provenance and diagnostics", () => {
  for (const outcome of STEP_OUTCOMES) {
    const step = StepResultJsonSchema.parse({
      kind: "job",
      label: "independent recipe",
      disposition: "run",
      group: "Main checkout",
      note: "declared command",
      outcome,
      duration_s: 2.3,
      output_path: "/retained/output",
      output_lines: 7,
      error_like_lines: 1,
      advisory: {
        kind: "optional-resource-unavailable",
        evidence: ["captured fact"],
        next_action: "Inspect the resource",
      },
    });
    assertEquals(stepResultToJson(stepResultFromJson(step)), step);
  }
});
