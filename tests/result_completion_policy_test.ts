/**
 * Cross-verb completion-policy parity and verdict semantics.
 *
 * The policy registry is the semantic companion to the public result-contract
 * registry: every serialized verb must declare what success requires, which
 * degradations may remain advisory, and how non-success states recover. These
 * tests deliberately inject future members and contradictory outcomes so the
 * guard proves the predicate rather than only recounting today's members.
 */

import {
  assert,
  assertEquals,
  assertStringIncludes,
  assertThrows,
} from "@std/assert";
import { renderResultMarkdown } from "../src/shared/result_markdown.ts";
import { resultPresenterForVerb } from "../src/shared/result_contracts.ts";
import { serializeResult } from "../src/shared/result_serialization.ts";
import { ExceptionClaimSchema } from "../src/engine/completion/exception_claim.ts";
import { EmergencyDataSchema } from "../src/shared/emergency.ts";
import { completionExitCode } from "../src/engine/logbook/cli.ts";
import { renderMcpResult } from "../src/engine/mcp/server.ts";
import { fire, HINTS, hintTexts } from "../src/shared/hints.ts";
import {
  observeResult,
  takeObservedResult,
} from "../src/shared/result_capture.ts";
import {
  appliedResult,
  type DiscernResult,
  verbatimStepLabel,
} from "../src/shared/result.ts";
import {
  CLI_JSON_RESULT_CONTRACTS,
  MCP_RESULT_CONTRACTS,
} from "../src/shared/result_contracts.ts";
import {
  completionPolicyCoverage,
  completionStateVerdict,
  evaluateResultCompletion,
  RESULT_COMPLETION_POLICIES,
} from "../src/shared/result_completion.ts";

const registeredVerbs = CLI_JSON_RESULT_CONTRACTS.map((contract) =>
  contract.verb
);

Deno.test("completion policies cover every result contract exactly once", () => {
  assertEquals(completionPolicyCoverage(registeredVerbs), {
    missing: [],
    stale: [],
    duplicates: [],
  });

  const futureVerbs = [...registeredVerbs, "future orbit"];
  assertEquals(completionPolicyCoverage(futureVerbs).missing, [
    "future orbit",
  ]);

  const setupPolicy = RESULT_COMPLETION_POLICIES.setup;
  assert(setupPolicy !== undefined);
  const injected = [
    ...Object.entries(RESULT_COMPLETION_POLICIES),
    ["setup", setupPolicy] as const,
    ["retired orbit", setupPolicy] as const,
  ];
  assertEquals(completionPolicyCoverage(registeredVerbs, injected), {
    missing: [],
    stale: ["retired orbit"],
    duplicates: ["setup: 2"],
  });
});

Deno.test("completion policies enroll schemas, MCP results, and every audited state", () => {
  const policyVerbs = Object.keys(RESULT_COMPLETION_POLICIES).sort();
  assertEquals(policyVerbs, [...registeredVerbs].sort());

  for (const contract of CLI_JSON_RESULT_CONTRACTS) {
    const policy = RESULT_COMPLETION_POLICIES[contract.verb];
    assert(policy !== undefined, `${contract.verb} has no completion policy`);
    assert(contract.schema !== undefined, `${contract.verb} has no schema`);
    assert(
      contract.presenter !== undefined,
      `${contract.verb} has no presenter`,
    );

    assertEquals(
      completionStateVerdict(policy, "required-success"),
      true,
      `${contract.verb}: required success`,
    );
    assertEquals(
      completionStateVerdict(policy, "required-failure"),
      false,
      `${contract.verb}: required failure`,
    );
    assertEquals(
      completionStateVerdict(policy, "refusal"),
      false,
      `${contract.verb}: refusal`,
    );
    assertEquals(
      completionStateVerdict(policy, "partial-effect"),
      false,
      `${contract.verb}: partial effect`,
    );
    assertEquals(
      completionStateVerdict(policy, "cancellation"),
      policy.cancellation === "successful-no-effect",
      `${contract.verb}: cancellation`,
    );
    assertEquals(
      completionStateVerdict(policy, "no-op"),
      policy.noOp === "success",
      `${contract.verb}: no-op`,
    );
    assertEquals(
      completionStateVerdict(policy, "optional-advisory"),
      policy.optionalAdvisories.length > 0,
      `${contract.verb}: optional advisory`,
    );
  }

  for (const contract of MCP_RESULT_CONTRACTS) {
    assert(
      RESULT_COMPLETION_POLICIES[contract.verb] !== undefined,
      `${contract.mcpTool} returns an ungoverned result`,
    );
  }
});

Deno.test("a failed required postcondition cannot remain ok true", () => {
  const lying: DiscernResult = {
    ok: true,
    verb: "setup begin",
    hints: hintTexts([
      fire(HINTS["setup-refresh-artifact-failed"], {
        message: "AGENTS.md could not be compiled",
      }),
    ]),
    data: {
      instruction_refresh: {
        status: "partial",
        compiled: [],
        failures: [{
          kind: "artifact",
          evidence: "AGENTS.md could not be compiled",
        }],
        effects_preserved: true,
        recovery: {
          command: "discern refresh",
          safe_to_retry: true,
        },
      },
    },
  };

  const evaluated = evaluateResultCompletion(lying);
  assertEquals(evaluated.ok, false);
  if (evaluated.ok) return;
  assertEquals(evaluated.error, "partial_refresh");
  assert(evaluated.message?.includes("instruction refresh") === true);

  const mcp = renderMcpResult(lying);
  assertEquals(mcp.structuredContent.ok, false);
  assertEquals(mcp.structuredContent.error, "partial_refresh");
  assertEquals(mcp.isError, true);
  assert(
    mcp.content[0]?.text.includes("did not complete") === true,
    "authored Markdown must project the same failed verdict",
  );

  const humanEnvelope = structuredClone(lying) as DiscernResult;
  const observed = observeResult(humanEnvelope);
  assertEquals(observed, humanEnvelope);
  assertEquals(humanEnvelope.ok, false);
  assertEquals(takeObservedResult()?.result.ok, false);
});

Deno.test("cancelled applied steps cannot form a successful result", () => {
  const result = appliedResult("test", [{
    step: {
      kind: "job",
      label: verbatimStepLabel("unit"),
      disposition: "run",
    },
    outcome: "cancelled",
  }]);
  assertEquals(result.ok, false);
  const completed = evaluateResultCompletion(result);
  assertEquals(completed.ok, false);
  if (completed.ok) return;
  assertEquals(completed.error, "apply_failed");
  assert(completed.message?.includes("cancelled") === true);
});

Deno.test("partial landing stays red and preserves exact effects", () => {
  const evaluated = evaluateResultCompletion({
    ok: true,
    verb: "accept",
    data: {
      landing: {
        recovery_performed: false,
        trunk_landed: true,
        worktree_removed: false,
        branch_deleted: false,
      },
    },
  });
  assertEquals(evaluated.ok, false);
  if (evaluated.ok) return;
  assertEquals(evaluated.error, "partial_acceptance");
  assertEquals(evaluated.data, {
    landing: {
      recovery_performed: false,
      trunk_landed: true,
      worktree_removed: false,
      branch_deleted: false,
    },
  });
  assertEquals(completionExitCode(0, evaluated), 1);
});

Deno.test("every typed required-postcondition evaluator rejects its planted failure", () => {
  const failures: readonly DiscernResult[] = [
    {
      ok: true,
      verb: "worktree setup",
      steps: [{
        step: {
          kind: "refresh",
          label: verbatimStepLabel("required refresh"),
          disposition: "run",
        },
        outcome: "failed",
      }],
    },
    {
      ok: true,
      verb: "setup begin",
      data: { phase: "fresh" },
      steps: [{
        step: {
          kind: "refresh",
          label: verbatimStepLabel("scaffold"),
          disposition: "run",
        },
        outcome: "ok",
      }],
    },
    {
      ok: true,
      verb: "refresh",
      data: { errors: ["AGENTS.md write failed"] },
    },
    {
      ok: true,
      verb: "doctor",
      data: {
        checks: [{ status: "fail", name: "Git", detail: "unavailable" }],
      },
    },
    {
      ok: true,
      verb: "done",
      data: { failed_stage: "test" },
    },
    {
      ok: true,
      verb: "setup done",
      data: { bootstrapped: false },
    },
    {
      ok: true,
      verb: "setup accept",
      data: { landed: false },
    },
    {
      ok: true,
      verb: "accept",
      data: {
        landing: {
          recovery_performed: false,
          trunk_landed: true,
          worktree_removed: false,
          branch_deleted: false,
        },
      },
    },
    {
      ok: true,
      verb: "skills eject",
      data: {
        materialized: {
          copied: 0,
          linked: 0,
          pruned: 0,
          errors: ["consumer directory unavailable"],
        },
      },
    },
  ];

  for (const planted of failures) {
    assertEquals(
      evaluateResultCompletion(planted).ok,
      false,
      `${planted.verb} accepted a failed required postcondition`,
    );
  }
});

Deno.test("optional degradations stay green only as typed advisories", () => {
  const optionalResource = evaluateResultCompletion({
    ok: true,
    verb: "worktree setup",
    steps: [{
      step: {
        kind: "resource-create",
        label: verbatimStepLabel("database"),
        disposition: "run",
      },
      outcome: "failed",
      advisory: {
        kind: "optional-resource-unavailable",
        evidence: ["database create exited non-zero"],
        next_action: "Repair the create command and retry setup if needed.",
      },
    }],
  });
  assertEquals(optionalResource.ok, true);
  assertEquals(
    optionalResource.advisories?.[0]?.kind,
    "optional-resource-unavailable",
  );

  const proofNote = evaluateResultCompletion({
    ok: true,
    verb: "accept",
    data: {
      landing: {
        recovery_performed: false,
        trunk_landed: true,
        worktree_removed: true,
        branch_deleted: true,
      },
      proof_note: {
        fetch: {
          status: "failed",
          errors: ["remote note fetch failed"],
        },
        write: { status: "recorded" },
      },
    },
  });
  assertEquals(proofNote.ok, true);
  assertEquals(proofNote.advisories?.[0]?.kind, "proof-recording-unavailable");
  assertEquals(proofNote.advisories?.[0]?.evidence, [
    "remote note fetch failed",
  ]);

  const checkpoint = evaluateResultCompletion({
    ok: true,
    verb: "checkpoints",
    data: {
      drops: [{
        scope: "policy",
        checkpoint: null,
        mode: null,
        reason: "merge_base_unresolved",
        account: "Git could not resolve the merge base",
      }],
    },
  });
  assertEquals(checkpoint.ok, true);
  assertEquals(checkpoint.advisories?.[0]?.kind, "checkpoint-evidence-dropped");

  const authority = evaluateResultCompletion({
    ok: true,
    verb: "start",
    data: {
      landing_authority: {
        kind: "unauthorized",
        warnings: ["scope evidence was unavailable"],
      },
    },
  });
  assertEquals(authority.ok, true);
  assertEquals(authority.advisories?.[0]?.kind, "landing-authority-unverified");

  const upgrade = evaluateResultCompletion({
    ok: true,
    verb: "upgrade",
    dry_run: true,
    data: {
      untranslated_gitattributes_patterns: [{
        group: "generated bundle",
        pattern: "{schema,reference}/**",
        reason: "brace expansion is not representable",
      }],
    },
  });
  assertEquals(upgrade.ok, true);
  assertEquals(
    upgrade.advisories?.[0]?.kind,
    "generated-attribute-pattern-untranslated",
  );
});

Deno.test("an advisory cannot waive completion without evidence and recovery", () => {
  assertThrows(
    () =>
      evaluateResultCompletion({
        ok: true,
        verb: "worktree setup",
        advisories: [{
          kind: "optional-resource-unavailable",
          evidence: [],
          next_action: "",
        }],
      }),
    Error,
    "needs non-blank evidence and next_action",
  );
});

Deno.test("emergency preparation success requires its receipt and excludes landing claims", () => {
  const prepared: DiscernResult = {
    ok: true,
    verb: "accept",
    data: { emergency: { outcome: "prepared", preparation: "receipt" } },
  };
  assertEquals(evaluateResultCompletion(prepared).ok, true);
  for (
    const data of [
      { emergency: { outcome: "prepared" } },
      {
        emergency: {
          outcome: "prepared",
          preparation: "receipt",
          confirmation: "approval",
        },
      },
      { emergency: { outcome: "prepared", preparation: "receipt" }, proof: {} },
      {
        emergency: { outcome: "prepared", preparation: "receipt" },
        landing: {},
      },
    ]
  ) assertEquals(evaluateResultCompletion({ ...prepared, data }).ok, false);
});

Deno.test("emergency outcomes preserve success only for complete independent landing claims", () => {
  const emergency = {
    outcome: "landed",
    landing_id: "landing",
    candidate_id: "candidate",
    reason: "Restore service",
    exceptions: [],
    retirement: "retained",
  };
  const result: DiscernResult = {
    ok: true,
    verb: "accept",
    data: { emergency },
  };
  for (const retirement of ["retained", "retired"]) {
    assertEquals(
      serializeResult({
        ...result,
        data: { emergency: { ...emergency, retirement } },
      }).ok,
      true,
    );
  }
  for (const outcome of EmergencyDataSchema.shape.outcome.unwrap().options) {
    if (outcome === "landed") continue;
    assertEquals(
      evaluateResultCompletion({
        ...result,
        data: { emergency: { ...emergency, outcome } },
      }).ok,
      false,
      outcome,
    );
  }
  for (
    const field of [
      "landing_id",
      "candidate_id",
      "reason",
      "exceptions",
      "retirement",
    ]
  ) {
    assertEquals(
      evaluateResultCompletion({
        ...result,
        data: { emergency: { ...emergency, [field]: undefined } },
      }).ok,
      false,
      field,
    );
  }
  for (const retirement of ["pending", "recovery", "unknown"]) {
    assertEquals(
      evaluateResultCompletion({
        ...result,
        data: { emergency: { ...emergency, retirement } },
      }).ok,
      false,
    );
  }
  for (
    const field of ["proof", "proof_line", "proof_note", "landing", "queue"]
  ) {
    assertEquals(
      evaluateResultCompletion({ ...result, data: { emergency, [field]: {} } })
        .ok,
      false,
      field,
    );
  }
  const failed: DiscernResult = {
    ...result,
    ok: false,
    error: "partial_acceptance",
  };
  assertEquals(
    evaluateResultCompletion(failed).ok,
    false,
    "A landed ref cannot hide failed settlement or convergence",
  );
});

Deno.test("policy-created failures retain registered recovery across every effect contract", () => {
  for (const contract of CLI_JSON_RESULT_CONTRACTS) {
    const policy = RESULT_COMPLETION_POLICIES[contract.verb];
    if (!policy?.requiredPostconditions.includes("executed-steps")) continue;
    const result: DiscernResult = {
      ok: true,
      verb: contract.verb,
      steps: [{
        step: {
          kind: "job",
          label: verbatimStepLabel("future orbit"),
          disposition: "run",
        },
        outcome: "cancelled",
      }],
    };
    const evaluated = evaluateResultCompletion(result);
    assertEquals(evaluated.ok, false, contract.verb);
    assertEquals(serializeResult(evaluated).ok, false, contract.verb);
    assertEquals(
      evaluateResultCompletion(evaluated),
      evaluated,
      "Evaluation must be idempotent",
    );
    assertEquals(renderMcpResult(result).isError, true, contract.verb);
  }
  const result: DiscernResult = {
    ok: true,
    verb: "accept",
    data: {},
    hints: hintTexts([
      fire(HINTS["completion-pending"], {
        action: "Inspect the recorded transition.",
      }),
    ]),
  };
  const evaluated = evaluateResultCompletion(result);
  assertEquals(evaluated.hints?.[0], result.hints?.[0]);
});

Deno.test("recovered exception prefixes retain their exact claim without ordinary authority or Proof", () => {
  const exception = ExceptionClaimSchema.parse({
    kind: "exception",
    authorization_id: "11111111-1111-4111-a111-111111111111",
    authorized_at: 1,
    actual_trunk: "a".repeat(40),
    source: {
      effort_id: "orbit-repair",
      branch: "refs/heads/orbit-repair",
      head: "b".repeat(40),
      tree: "c".repeat(40),
    },
    candidate_id: "22222222-2222-4222-a222-222222222222",
    candidate_head: "b".repeat(40),
    policy: "d".repeat(64),
    reason: "Restore the service",
    exceptions: [{
      requirement: {
        id: "audit",
        context: "local",
        kind: "job",
        definition: "e".repeat(64),
      },
      state: "unrun",
      evidence_id: null,
    }],
  });
  const prefix = {
    effort: exception.source.effort_id,
    branch: exception.source.branch,
    source_head: exception.source.head,
    candidate_id: exception.candidate_id,
    expected_trunk: exception.actual_trunk,
    target: exception.candidate_head,
    state: "landed",
    landing_id: "33333333-3333-4333-a333-333333333333",
    authority_id: null,
    authority_settlement: "consumed",
    pending: [],
    retirement: "retained",
    exception,
  };
  const resultFor = (row: unknown): DiscernResult => ({
    ok: true,
    verb: "accept",
    data: { root: "/project", queue: [row], pending: [] },
  });
  assertEquals(evaluateResultCompletion(resultFor(prefix)).ok, true);
  assertEquals(serializeResult(resultFor(prefix)).ok, true);
  assertStringIncludes(
    renderResultMarkdown(
      serializeResult(resultFor(prefix)),
      resultPresenterForVerb("accept"),
    ),
    "emergency exception, no passing Proof",
  );
  assertEquals(
    evaluateResultCompletion({
      ...resultFor(prefix),
      ok: false,
      error: "partial_acceptance",
    }).ok,
    false,
  );
  for (const key of Object.keys(ExceptionClaimSchema.shape)) {
    if (key === "review") continue;
    const broken = { ...exception };
    Reflect.deleteProperty(broken, key);
    assertEquals(
      evaluateResultCompletion(resultFor({ ...prefix, exception: broken })).ok,
      false,
      key,
    );
  }
  for (
    const field of [
      "effort",
      "branch",
      "source_head",
      "candidate_id",
      "expected_trunk",
      "target",
      "authority_settlement",
    ]
  ) {
    assertEquals(
      evaluateResultCompletion(resultFor({ ...prefix, [field]: "unrelated" }))
        .ok,
      false,
      field,
    );
  }
  for (
    const field of [
      "proof_line",
      "proof_note",
      "consent",
      "variances",
      "standard_approvals",
      "authority_id",
    ]
  ) {
    assertEquals(
      evaluateResultCompletion(resultFor({ ...prefix, [field]: "unrelated" }))
        .ok,
      false,
      field,
    );
  }
  for (const exception of [undefined, null, {}, { kind: "future-orbit" }]) {
    assertEquals(
      evaluateResultCompletion(resultFor({ ...prefix, exception })).ok,
      false,
    );
  }
  const ordinary = {
    ...prefix,
    exception: undefined,
    authority_id: "ordinary-authority",
  };
  assertEquals(evaluateResultCompletion(resultFor(ordinary)).ok, true);
  assertEquals(
    evaluateResultCompletion({
      ok: true,
      verb: "accept",
      data: { queue: [prefix, ordinary], pending: [] },
    }).ok,
    true,
  );
});
