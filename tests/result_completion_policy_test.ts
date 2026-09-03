/**
 * Cross-verb completion-policy parity and verdict semantics.
 *
 * The policy registry is the semantic companion to the public result-contract
 * registry: every serialized verb must declare what success requires, which
 * degradations may remain advisory, and how non-success states recover. These
 * tests deliberately inject future members and contradictory outcomes so the
 * guard proves the predicate rather than only recounting today's members.
 */

import { assert, assertEquals, assertThrows } from "@std/assert";
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
