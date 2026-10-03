/**
 * Every reason a run reports for evidence that no longer applies comes from
 * the comparison that found it. The runtime's comparisons run against a real
 * checkout and its completion records; every run outcome is then crossed with
 * every finding a closing verification can return, and the rendered pending
 * causes must name exactly the computed reason.
 */
import { assert, assertEquals } from "@std/assert";
import { join } from "@std/path";
import { ON_DISK_FORMATS } from "../src/shared/on_disk_formats.ts";
import { candidateAuthor } from "../src/engine/completion/candidate.ts";
import {
  AttemptClaimLost,
  claimLossBlocker,
} from "../src/engine/completion/attempt.ts";
import { CompletionRecordSchema } from "../src/engine/completion/records.ts";
import {
  type CompletionWriteOutcome,
  openCompletionRecordStore,
  readCompletionRecord,
  writeCompletionRecord,
} from "../src/engine/completion/store.ts";
import type {
  ClaimedExecution,
  CompletionBlocker,
} from "../src/engine/completion/protocol.ts";
import { completionBlockerAccount } from "../src/engine/completion/progress_prose.ts";
import {
  type InvalidationReason,
  InvalidationReasonSchema,
} from "../src/engine/completion/outcomes.ts";
import { publicationRefusal } from "../src/engine/completion/source_tip.ts";
import {
  executeValidation,
  type ProducerCapture,
  type ValidationRuntime,
  ValidationSubjectChanged,
} from "../src/engine/validation/execute.ts";
import { planValidation } from "../src/engine/validation/plan.ts";
import {
  createValidationRuntime,
  observeValidationInputs,
  verifyValidationInputs,
} from "../src/engine/validation/runtime.ts";
import type { ValidationSnapshot } from "../src/engine/validation/catalog.ts";
import { REPO_ROOT } from "./repo_authored_paths.ts";
import { structuralGuardScope } from "./structural_guard_scope.ts";
import { withTempDir } from "./helpers.ts";
import { git, gitInit, gitOut } from "./engine_helpers.ts";
import {
  captured,
  claimed,
  COMPLETION_CLOCK,
  completionId,
  CONDITIONS,
  countedRuntime,
  observation,
  PRODUCER_RECIPE,
  snapshot,
} from "./completion_producers_fixtures.ts";

/** What one verification established: a named change, nothing, or no answer. */
type Finding = InvalidationReason | "unchanged" | "unverifiable";

/** A committed checkout whose live attempt and candidate are recorded. */
interface RecordedCheckout {
  readonly root: string;
  readonly snap: ValidationSnapshot;
  readonly execution: ClaimedExecution;
  /** The production runtime, planned on `environment` and the checkout's inputs. */
  readonly runtime: (environment?: Record<string, string>) => ValidationRuntime;
}

/** Commit a checkout and record its live attempt and candidate. */
async function recordedCheckout(root: string): Promise<RecordedCheckout> {
  // The toolchain file is ignored, so a change to it reaches only the
  // planned-input comparison and never the checkout status.
  await Deno.writeTextFile(join(root, ".gitignore"), "tool.lock\n");
  await Deno.writeTextFile(join(root, "tool.lock"), "toolchain v1\n");
  await gitInit(root);
  const baseline = await snapshot();
  const head = await gitOut(root, "rev-parse", "HEAD");
  const tree = await gitOut(root, "rev-parse", "HEAD^{tree}");
  const toolchain = PRODUCER_RECIPE.toolchain;
  const inputs = await observeValidationInputs(root, toolchain);
  const snap = await snapshot({
    candidate: {
      ...baseline.candidate,
      attempt_id: completionId(101),
      head,
      tree,
      sources: [{ ...candidateAuthor(baseline.candidate), head, tree }],
    },
    inputs,
  });
  const plan = planValidation(snap, observation(), {
    kind: "done",
    mode: "strict",
    requirements: snap.requirements,
  });
  const execution = { ...claimed(snap, plan), path: root };
  const conditions = CONDITIONS[0];
  assert(conditions !== undefined);
  for (
    const [record, fence] of [
      [{
        kind: "attempt",
        id: execution.attempt.identity.id,
        data: execution.attempt,
      }, undefined],
      [
        { kind: "candidate", id: snap.candidate_id, data: snap.candidate },
        execution.fence,
      ],
    ] as const
  ) {
    assertEquals(
      (await writeCompletionRecord(
        root,
        CompletionRecordSchema.parse({
          version: ON_DISK_FORMATS.completionRecord.version,
          revision: 1,
          ...record,
        }),
        null,
        fence,
      )).kind,
      "written",
    );
  }
  return {
    root,
    snap,
    execution,
    runtime: (environment = { MODE: "test" }) =>
      createValidationRuntime({
        root,
        conditions,
        environment,
        inheritedEnvironment: { get: () => undefined },
        timeout: 30,
        verifyConditions: () => verifyValidationInputs(root, inputs, toolchain),
        clock: COMPLETION_CLOCK,
      }),
  };
}

/** Another run closes the attempt, as recovery does after a lapsed lease. */
async function retire(
  root: string,
  execution: ClaimedExecution,
): Promise<void> {
  const current = await readCompletionRecord(root, {
    kind: "attempt",
    id: execution.attempt.identity.id,
  });
  assert(current.kind === "recorded" && current.record.kind === "attempt");
  assertEquals(
    (await writeCompletionRecord(
      root,
      CompletionRecordSchema.parse({
        ...current.record,
        revision: current.record.revision + 1,
        data: {
          ...current.record.data,
          state: { kind: "finished", outcome: "cancelled", finished_at: 150 },
        },
      }),
      current.stamp,
    )).kind,
    "written",
  );
}

/** Replace a record's bytes in place, outside the store's transition rules. */
async function overwrite(
  root: string,
  selector: { readonly kind: "attempt" | "candidate"; readonly id: string },
  text: (current: string) => string,
): Promise<void> {
  const store = await openCompletionRecordStore(root);
  assert(store !== undefined);
  const path = store.path(selector);
  await Deno.writeTextFile(path, text(await Deno.readTextFile(path)));
}

/** What the closing verification established for this checkout, and said. */
async function finding(
  runtime: ValidationRuntime,
  execution: ClaimedExecution,
): Promise<{ readonly found: Finding; readonly message?: string }> {
  try {
    await runtime.verify(execution, { allowCancelled: true });
    return { found: "unchanged" };
  } catch (error) {
    assert(error instanceof Error);
    return {
      found: error instanceof ValidationSubjectChanged
        ? error.reason
        : "unverifiable",
      message: error.message,
    };
  }
}

/** One state the checkout can reach during a run, and what verification must find. */
interface CheckoutChange {
  readonly name: string;
  readonly found: Finding;
  readonly change: (
    checkout: RecordedCheckout,
  ) => Promise<
    { runtime?: ValidationRuntime; execution?: ClaimedExecution } | void
  >;
}

const CHECKOUT_CHANGES: readonly CheckoutChange[] = [
  { name: "nothing changed", found: "unchanged", change: async () => {} },
  {
    name: "another run retired the attempt",
    found: "claim-lost",
    change: ({ root, execution }) => retire(root, execution),
  },
  {
    name: "the recorded candidate names another source",
    found: "source-replaced",
    change: ({ root, snap }) =>
      overwrite(
        root,
        { kind: "candidate", id: snap.candidate_id },
        (text) => text.replace(snap.candidate.tree, "f".repeat(40)),
      ),
  },
  {
    name: "a commit moved HEAD",
    found: "source-replaced",
    change: ({ root }) =>
      git(root, "commit", "-q", "--allow-empty", "-m", "moved"),
  },
  {
    name: "a file appeared in the checkout",
    found: "inputs-changed",
    change: ({ root }) => Deno.writeTextFile(join(root, "new.txt"), "new\n"),
  },
  {
    name: "an ignored toolchain file changed",
    found: "inputs-changed",
    change: ({ root }) =>
      Deno.writeTextFile(join(root, "tool.lock"), "toolchain v2\n"),
  },
  {
    name: "a declared environment variable changed",
    found: "environment-changed",
    change: (checkout) =>
      Promise.resolve({ runtime: checkout.runtime({ MODE: "other" }) }),
  },
  {
    name: "the checkout seed changed",
    found: "seed-changed",
    change: ({ execution }) =>
      Promise.resolve({ execution: { ...execution, seed: 7 } }),
  },
  {
    name: "the attempt record is unreadable",
    found: "unverifiable",
    change: ({ root, execution }) =>
      overwrite(
        root,
        { kind: "attempt", id: execution.attempt.identity.id },
        () => "{",
      ),
  },
  {
    name: "the candidate record is unreadable",
    found: "unverifiable",
    change: ({ root, snap }) =>
      overwrite(root, { kind: "candidate", id: snap.candidate_id }, () => "{"),
  },
  {
    name: "Git cannot read the checkout's index",
    found: "unverifiable",
    change: ({ root }) =>
      Deno.writeTextFile(join(root, ".git", "index"), "garbage"),
  },
];

Deno.test("each verification comparison reports what it found, and only that", async () => {
  for (const scenario of CHECKOUT_CHANGES) {
    await withTempDir(async (root) => {
      const checkout = await recordedCheckout(root);
      const changed = await scenario.change(checkout) ?? {};
      const verified = await finding(
        changed.runtime ?? checkout.runtime(),
        changed.execution ?? checkout.execution,
      );
      assertEquals(verified.found, scenario.found, scenario.name);
      if (verified.found === "claim-lost") {
        // Whichever step finds the retirement, it is told in one sentence.
        assertEquals(verified.message, new AttemptClaimLost().message);
      }
    });
  }
});

Deno.test("every change a production comparison can report is exercised against a real checkout", async () => {
  // A comparison that raises a new reason, or computes its reason, must
  // arrive with a row above that drives it from a real checkout.
  const files = await structuralGuardScope({
    guard: "tests/completion_verification_reason_test.ts#raised-reasons",
    universe: "authored-ts",
    narrow: {
      reason:
        "Verification comparisons are production engine code; tests raise findings only to drive the mapping.",
      include: (path) => path.startsWith("src/"),
    },
  });
  const raised = new Set<string>();
  for (const path of files) {
    const source = await Deno.readTextFile(join(REPO_ROOT, path));
    for (
      const match of source.matchAll(
        /\bnew ValidationSubjectChanged\(\s*([^,]*),/gu,
      )
    ) {
      const literal = /^"([a-z-]+)"$/u.exec(match[1]?.trim() ?? "");
      assert(
        literal?.[1] !== undefined,
        `${path}: ValidationSubjectChanged names its reason as a literal, so its comparison is enumerable`,
      );
      raised.add(literal[1]);
    }
  }
  assert(raised.size > 0, "the guard must observe the production comparisons");
  assertEquals(
    [...raised].sort(),
    [
      ...new Set(
        CHECKOUT_CHANGES.flatMap((scenario) =>
          scenario.found === "unchanged" || scenario.found === "unverifiable"
            ? []
            : [scenario.found]
        ),
      ),
    ].sort(),
  );
});

/** How the run's producers ended before the closing verification. */
const RUN_OUTCOMES = ["passed", "failed", "interrupted", "retired"] as const;

/**
 * Where the change surfaces: only at the closing verification, or already at
 * a producer's pre-check, before the coordinator has delivered any abort.
 */
const RAISED_AT = ["closing", "pre-check"] as const;

/** Every finding a verification can return. */
const FINDINGS: readonly Finding[] = [
  "unchanged",
  ...InvalidationReasonSchema.options,
  "unverifiable",
];

/** The rendered pending causes a run reports, as narration prints them. */
function rendered(blockers: readonly CompletionBlocker[]): string[] {
  return blockers.map((blocker) => {
    const account = completionBlockerAccount(blocker);
    return `${account.reason} ${account.next}`;
  });
}

Deno.test("a run reports a stale reason only when its verification computed it", async () => {
  const snap = await snapshot();
  const plan = planValidation(snap, observation(), {
    kind: "done",
    mode: "strict",
    requirements: snap.requirements,
  });
  const claimLoss = new AttemptClaimLost().message;
  const unverifiable = "Cannot verify the candidate checkout.";
  for (const raised of RAISED_AT) {
    for (const outcome of RUN_OUTCOMES) {
      for (const found of FINDINGS) {
        const controller = new AbortController();
        const execution = { ...claimed(snap, plan), signal: controller.signal };
        const produced = (): ProducerCapture => {
          if (outcome === "passed") return captured();
          if (outcome === "interrupted") controller.abort();
          if (outcome === "retired") controller.abort(new AttemptClaimLost());
          return {
            outcome: outcome === "failed" ? "failed" : "cancelled",
            complete: false,
            output: new Uint8Array(),
            artifacts: [],
            reason: `producer ${outcome}`,
          };
        };
        // The run's opening verification always holds; the change lands after.
        let verifications = 0;
        const { runtime } = countedRuntime({
          produce: () => Promise.resolve(produced()),
          verify: (_execution, options) => {
            verifications++;
            const refuses = found !== "unchanged" &&
              (raised === "closing"
                ? options?.allowCancelled === true
                : verifications > 1);
            if (!refuses) return Promise.resolve();
            return Promise.reject(
              found === "unverifiable"
                ? new Error(unverifiable)
                : new ValidationSubjectChanged(
                  found,
                  found === "claim-lost" ? claimLoss : `found ${found}`,
                ),
            );
          },
        });
        const result = await executeValidation(
          snap,
          plan,
          execution,
          runtime,
          COMPLETION_CLOCK,
        );
        const label = `${raised} × ${outcome} × ${found}`;
        const computed = found === "unchanged" || found === "unverifiable" ||
            found === "claim-lost"
          ? undefined
          : found;
        assertEquals(
          result.blockers.flatMap((blocker) =>
            blocker.kind === "stale-evidence" ? [blocker.reason] : []
          ),
          computed === undefined ? [] : [computed],
          label,
        );
        const lines = rendered(result.blockers);
        for (const reason of InvalidationReasonSchema.options) {
          assertEquals(
            lines.some((line) => line.includes(reason)),
            reason === computed,
            `${label}: ${reason} in ${JSON.stringify(lines)}`,
          );
        }
        assertEquals(
          lines.some((line) => line.includes(claimLoss)),
          found === "claim-lost" ||
            controller.signal.reason instanceof AttemptClaimLost,
          `${label}: ${JSON.stringify(lines)}`,
        );
        assertEquals(
          result.blockers.some((blocker) =>
            blocker.kind === "unavailable" && blocker.reason === unverifiable
          ),
          found === "unverifiable",
          label,
        );
        if (found === "claim-lost" && raised === "pre-check") {
          assertEquals(
            result.blockers.filter((blocker) =>
              blocker.kind === "validation-failed"
            ),
            [],
            `${label}: a retired run was cancelled, not failed`,
          );
        }
        if (found !== "unchanged") {
          assert(
            result.evidence.every((component) =>
              component.outcome.kind !== "passed"
            ),
            `${label}: a refused verification leaves no passing evidence`,
          );
        }
      }
    }
  }
});

Deno.test("a run whose claim another run retired reports the retirement, not changed inputs", async () => {
  await withTempDir(async (root) => {
    const checkout = await recordedCheckout(root);
    const controller = new AbortController();
    const execution = { ...checkout.execution, signal: controller.signal };
    const plan = planValidation(checkout.snap, observation(), {
      kind: "done",
      mode: "strict",
      requirements: checkout.snap.requirements,
    });
    const result = await executeValidation(checkout.snap, plan, execution, {
      ...checkout.runtime(),
      produce: async () => {
        await retire(root, execution);
        controller.abort(new AttemptClaimLost());
        return {
          outcome: "cancelled",
          complete: false,
          output: new Uint8Array(),
          artifacts: [],
          reason: new AttemptClaimLost().message,
        };
      },
    }, COMPLETION_CLOCK);
    assertEquals(
      [...new Set(rendered(result.blockers))],
      rendered([claimLossBlocker()]),
    );
  });
});

Deno.test("a refused publication reports the refusal it received", () => {
  // Every refusal a write can return, with the pending kind it leaves. A new
  // member of the union fails `deno check` here until it is placed.
  const expected = {
    "claim-lost": "cancelled",
    "conflict": "unavailable",
    "transition-refused": "unavailable",
    "busy": "unavailable",
    "newer": "record-incompatible",
    "older": "record-incompatible",
    "invalid": "record-corrupt",
    "unavailable": "unavailable",
  } satisfies Record<
    Exclude<CompletionWriteOutcome["kind"], "written">,
    CompletionBlocker["kind"]
  >;
  const evidenceId = completionId(700);
  for (const [kind, pending] of Object.entries(expected)) {
    const refusal = (kind === "newer" || kind === "older"
      ? { kind, version: 99 }
      : { kind, reason: `refused as ${kind}` }) as Exclude<
        CompletionWriteOutcome,
        { kind: "written" }
      >;
    const blocker = publicationRefusal(evidenceId, refusal);
    assertEquals(blocker.kind, pending, kind);
    assertEquals(
      blocker.kind === "cancelled" &&
        blocker.reason === claimLossBlocker().reason,
      kind === "claim-lost",
      kind,
    );
  }
});
