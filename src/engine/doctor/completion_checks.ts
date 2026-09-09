/**
 * `discern doctor`'s completion checks: what the configured validation
 * establishes, how its limits combine, and what the durable completion records
 * currently hold.
 *
 * Two groups, both read-only:
 *  - configuration checks derive from `discern.toml` alone through the shared
 *    capacity and producer authorities, so setup and doctor explain the same
 *    facts;
 *  - record checks observe the completion records in common Git administration
 *    and name the supported next action. A recorded claim is observed live the
 *    way `status` observes it: whether a native operation still holds the
 *    checkout and whether the attempt's recorded children have stopped. Doctor
 *    never repairs, releases, or recovers anything; the effectful recovery
 *    command reacquires ownership under exclusion before it returns anything.
 */

import type { DiscernConfig } from "../../shared/config_schema.ts";
import type { Check } from "../../shared/result_schemas.ts";
import {
  commandExists,
  leadingCommandWord,
  runGit,
} from "../../shared/subprocess.ts";
import { type Clock, SYSTEM_CLOCK } from "../../shared/clock.ts";
import { executionRecoveryCommand } from "../../shared/execution_recovery.ts";
import { newerOnDiskFormatMessage } from "../../shared/on_disk_formats.ts";
import {
  completionCapacityFacts,
  describeCompletionCapacity,
} from "../completion/capacity_facts.ts";
import {
  CANDIDATE_BOUND_REMEDY,
  producerFacts,
} from "../validation/producer_facts.ts";
import { observeCompletionRecords } from "../validation/runtime.ts";
import { openCompletionRecordStore } from "../completion/store.ts";
import { observedRecords } from "../landing_queue/repository.ts";
import { emergencyValidationStatus } from "../emergency/obligations.ts";
import type { CompletionObservation } from "../completion/protocol.ts";
import {
  type ExecutionClaimObservation,
  observeExecutionClaim,
} from "../execution/public_recovery.ts";
import {
  declarationProofStates,
  unprovenDeclarationReason,
} from "../execution/probe_record.ts";

/** A check before doctor grades it; `status` defaults from `ok` and `warn`. */
export type DoctorDraftCheck = Omit<Check, "status"> & {
  status?: Check["status"];
};

/** At most this many named items in one check's detail; the rest are counted. */
const LISTED_ITEMS = 8;

/** Join a list for prose, bounding its length, with a fallback for an empty list. */
function list(items: readonly string[], empty = "none"): string {
  if (items.length === 0) return empty;
  const shown = items.slice(0, LISTED_ITEMS).join(", ");
  const rest = items.length - LISTED_ITEMS;
  return rest > 0 ? `${shown}, and ${rest} more` : shown;
}

/** Checks derived from configuration alone: limits, environments, producers, closures. */
export async function completionConfigurationChecks(
  destDir: string,
  config: DiscernConfig,
): Promise<DoctorDraftCheck[]> {
  const checks: DoctorDraftCheck[] = [];
  // The proof record lives in Git administration; outside a repository the
  // facts describe configuration alone.
  const inside = await runGit(["rev-parse", "--is-inside-work-tree"], {
    cwd: destDir,
  });
  const proofs = inside.success && inside.stdout.trim() === "true"
    ? await declarationProofStates(destDir, config)
    : undefined;
  const capacity = completionCapacityFacts(
    config,
    2,
    proofs === undefined ? undefined : [...proofs.entries()].filter((
      [, state],
    ) => state.state === "proven" || state.state === "not-rehearsed").map((
      [context],
    ) => context),
  );
  const speculationStalled = capacity.speculation.kind === "undeclared" ||
    capacity.speculation.kind === "unproven" ||
    capacity.speculation.kind === "no-slot";
  checks.push({
    name: "completion capacity",
    ok: true,
    detail: describeCompletionCapacity(capacity).join(" "),
    ...(speculationStalled
      ? {
        status: "warn" as const,
        fix: capacity.speculation.kind === "undeclared"
          ? "declare `[execution.<context>]` for each required context once the project can prepare and restore a checkout, or set `[completion].lookahead = 0` to make the ordering-only behavior explicit"
          : capacity.speculation.kind === "unproven"
          ? "run `discern setup done` from a clean committed tree to prove the declaration as it stands, or set `[completion].lookahead = 0`"
          : "set `[completion].concurrency` to 2 or more, raise the declared environment `capacity`, or set `[completion].lookahead = 0`",
      }
      : {}),
  });

  for (const [context, declaration] of Object.entries(config.execution)) {
    const missing: string[] = [];
    for (
      const [phase, procedure] of [
        ["prepare", declaration.prepare],
        ["restore", declaration.restore],
        ["reset", declaration.reset],
        ["dispose", declaration.dispose],
      ] as const
    ) {
      if (procedure === undefined) continue;
      const steps = typeof procedure === "string" ? [procedure] : procedure;
      for (const step of steps) {
        const word = leadingCommandWord(step);
        if (
          word !== undefined && !(await commandExists(word, { cwd: destDir }))
        ) {
          missing.push(`${phase} → ${word}`);
        }
      }
    }
    const required = config.completion.required_contexts.includes(context);
    const procedures = [
      "prepare",
      declaration.restore === undefined ? undefined : "restore",
      declaration.reset === undefined ? undefined : "reset",
      declaration.dispose === undefined ? undefined : "dispose",
    ].filter((name): name is string => name !== undefined);
    const summary =
      `${declaration.kind} checkout, capacity ${declaration.capacity}, ${
        list(procedures)
      } declared${
        declaration.ignored.length === 0
          ? ""
          : `, restores ignored ${list(declaration.ignored)}`
      }`;
    if (missing.length > 0) {
      checks.push({
        name: `execution environment: ${context}`,
        ok: false,
        detail: `${summary}; command not found: ${missing.join(", ")}`,
        fix:
          `install the tool, or fix the named procedure in [execution.${context}]`,
      });
    } else if (!required) {
      checks.push({
        name: `execution environment: ${context}`,
        ok: true,
        status: "warn",
        detail:
          `${summary}; \`${context}\` is not one of [completion].required_contexts (${
            list(config.completion.required_contexts)
          }), so completion never selects this declaration`,
        fix:
          `rename the table to a required context, add \`${context}\` to [completion].required_contexts, or remove the declaration`,
      });
    } else {
      const proof = proofs?.get(context);
      if (proof === undefined || proof.state === "proven") {
        checks.push({
          name: `execution environment: ${context}`,
          ok: true,
          detail: `${summary}; each procedure's leading command resolves. ${
            proof === undefined
              ? "`discern setup done` proves the return procedure in a throwaway worktree; a declaration alone is not that proof"
              : `\`discern setup done\` proved this exact declaration's return after a passing, a failing, and a cancelled validation (source ${
                proof.proof.source.head.slice(0, 12)
              })`
          }`,
        });
      } else if (proof.state === "not-rehearsed") {
        checks.push({
          name: `execution environment: ${context}`,
          ok: true,
          detail:
            `${summary}; each procedure's leading command resolves. Setup does not rehearse an isolated environment; a separate copy is provided for it outside the setup worktree`,
        });
      } else {
        checks.push({
          name: `execution environment: ${context}`,
          ok: true,
          status: "warn",
          detail: `${summary}; each procedure's leading command resolves, but ${
            unprovenDeclarationReason(context, proof)
          }`,
          fix:
            "run `discern setup done` from a clean committed tree; it rehearses the declaration in a throwaway worktree and records the proof, or remove the declaration and set `[completion].lookahead = 0`",
        });
      }
    }
  }

  const producers = await producerFacts(config);
  if (producers.error !== undefined) {
    checks.push({
      name: "producer coverage",
      ok: false,
      detail:
        `validation cannot resolve its producers: ${producers.error}. \`discern done\` would refuse before running anything`,
      fix:
        "point each standard's `producer` at an existing `jobs.<name>`, `scopes.<name>.gate`, or `standards.<name>`, and remove dependency cycles",
    });
  } else {
    const sharedDetail = producers.shared.map((entry) =>
      `${entry.producer} supplies ${entry.standards.join(", ")}`
    );
    const summary = `${producers.producers.length} producer${
      producers.producers.length === 1 ? "" : "s"
    }; ${
      producers.standards.length === 0
        ? "no standards configured"
        : `${producers.standards.length} standard${
          producers.standards.length === 1 ? "" : "s"
        }${sharedDetail.length === 0 ? "" : ` (${sharedDetail.join("; ")})`}`
    }`;
    if (producers.duplicated.length > 0) {
      const repeats = producers.duplicated.map((group) =>
        `${group.producers.join(" and ")} both run \`${
          group.commands.join(" && ")
        }\``
      );
      checks.push({
        name: "producer coverage",
        ok: true,
        status: "warn",
        detail: `${summary}; the same work runs twice under different names: ${
          repeats.join("; ")
        }`,
        fix:
          'keep one `run` and point the others at it with `producer = "jobs.<name>"` (or `producer = "standards.<name>"` for a shared measurement) so one execution supplies every reading',
      });
    } else {
      checks.push({ name: "producer coverage", ok: true, detail: summary });
    }
    checks.push({
      name: "evidence reuse",
      ok: true,
      detail: producers.candidate_bound.length === 0
        ? producers.producers.length === 0
          ? "no producers configured yet"
          : "every producer declares its inputs, so unchanged evidence is reused across commits"
        : `candidate-bound: ${
          list(producers.candidate_bound)
        }. Evidence for these is produced again for every commit. ${CANDIDATE_BOUND_REMEDY}`,
    });
  }
  return checks;
}

/** The completion store observed once, or undefined outside a usable repository. */
async function observeStore(
  root: string,
  clock: Clock,
): Promise<CompletionObservation | undefined> {
  const inside = await runGit(["rev-parse", "--is-inside-work-tree"], {
    cwd: root,
  });
  if (!inside.success || inside.stdout.trim() !== "true") return undefined;
  if (await openCompletionRecordStore(root) === undefined) return undefined;
  return await observeCompletionRecords(root, clock);
}

/** Read-only checks over the durable completion records. */
export async function completionRecordChecks(
  root: string,
  clock: Clock = SYSTEM_CLOCK,
): Promise<DoctorDraftCheck[]> {
  const observation = await observeStore(root, clock);
  if (observation === undefined) return [];
  const checks: DoctorDraftCheck[] = [];
  const now = clock.wallNow();

  const unreadable = observation.records.filter(({ reading }) =>
    reading.kind !== "recorded" && reading.kind !== "missing"
  );
  const newer = unreadable.filter(({ reading }) => reading.kind === "newer");
  if (newer.length > 0) {
    const found = Math.max(
      ...newer.map(({ reading }) =>
        reading.kind === "newer" ? reading.version : 0
      ),
    );
    checks.push({
      name: "completion records",
      ok: false,
      detail: `${newer.length} record${
        newer.length === 1 ? "" : "s"
      } written by a newer discern (${
        newer.map(({ selector }) => `${selector.kind}/${selector.id}`).join(
          ", ",
        )
      }). ${newerOnDiskFormatMessage("completionRecord", found)}`,
      fix:
        "update discern, then read the records again; do not edit or delete them with this build",
    });
  } else if (unreadable.length > 0) {
    checks.push({
      name: "completion records",
      ok: true,
      status: "warn",
      detail: `${unreadable.length} record${
        unreadable.length === 1 ? " is" : "s are"
      } unreadable: ${
        unreadable.map(({ selector, reading }) =>
          `${selector.kind}/${selector.id} (${reading.kind}${
            "reason" in reading ? `: ${reading.reason}` : ""
          })`
        ).join("; ")
      }`,
      fix:
        "preserve the record bytes and restore them from the engine that wrote them; nothing that reads them treats the damage as absence",
    });
  } else {
    checks.push({
      name: "completion records",
      ok: true,
      detail: observation.records.length === 0
        ? "none yet"
        : `${observation.records.length} readable`,
    });
  }

  const records = observedRecords(observation);
  const environments = records.filter((record) =>
    record.kind === "environment"
  );
  const attempts = records.filter((record) => record.kind === "attempt");
  const queue = records.find((record) => record.kind === "queue");
  const activeClaimFor = (candidateId: string | null): boolean =>
    attempts.some((record) =>
      record.kind === "attempt" &&
      record.data.identity.candidate_id === candidateId &&
      (record.data.state.kind === "claimed" ||
        record.data.state.kind === "composing") &&
      record.data.state.claim.expires_at > now
    );

  if (environments.length > 0) {
    const claims: {
      readonly label: string;
      readonly expired: boolean;
      readonly observed: ExecutionClaimObservation;
    }[] = [];
    let released = 0;
    let held = 0;
    let retired = 0;
    for (const record of environments) {
      if (record.kind !== "environment") continue;
      const state = record.data.state;
      if (state.kind === "executing") {
        claims.push({
          label:
            `${record.id} (attempt ${state.attempt_id}, phase ${state.phase}, at ${record.data.path})`,
          expired: state.claim.expires_at <= now,
          observed: await observeExecutionClaim(root, record, state),
        });
      } else if (state.kind === "idle") {
        if (record.data.release.kind === "released") released++;
        else held++;
      } else if (state.kind === "disposed") {
        retired++;
      }
    }
    // A recorded claim is graded by what was observed, never by its deadline
    // alone: a live owner is ordinary work, however old the claim; an absent
    // owner is abandoned work whose children must be proved stopped before
    // recovery can return the checkout.
    const owned = claims.filter((claim) => claim.observed.ownership === "held");
    const abandoned = claims.filter((claim) =>
      claim.observed.ownership === "available"
    );
    const unobserved = claims.filter((claim) =>
      claim.observed.ownership === "unknown"
    );
    const counts = [
      released === 0 ? undefined : `${released} released and idle`,
      held === 0
        ? undefined
        : `${held} held by ${held === 1 ? "its" : "their"} owner`,
      owned.length === 0
        ? undefined
        : `${owned.length} with a live owner${
          owned.some((claim) => claim.expired)
            ? " (one or more past their validation deadline; the owning run cancels and returns them)"
            : ""
        }`,
      retired === 0 ? undefined : `${retired} retired`,
    ].filter((part): part is string => part !== undefined);
    if (abandoned.length > 0 || unobserved.length > 0) {
      const stopped = abandoned.filter((claim) =>
        claim.observed.children_quiescent === true
      );
      const running = abandoned.filter((claim) =>
        claim.observed.children_quiescent !== true
      );
      const parts = [
        ...stopped.map((claim) =>
          `${claim.label}: no operation holds the checkout and every recorded child process has stopped, so the claim is abandoned`
        ),
        ...running.map((claim) =>
          `${claim.label}: no operation holds the checkout, but child work is not proved stopped (${claim.observed.reason})`
        ),
        ...unobserved.map((claim) =>
          `${claim.label}: ownership could not be observed (${claim.observed.reason})`
        ),
      ];
      const fixes = [
        stopped.length === 0
          ? undefined
          : `for an abandoned claim, run ${
            executionRecoveryCommand("<environment-id>")
          } from its worktree; recovery reacquires ownership and returns the checkout without validating or landing`,
        running.length === 0
          ? undefined
          : "for unstopped child work, stop the named process group or reconcile its receipts first; recovery refuses until every recorded child is absent",
        unobserved.length === 0
          ? undefined
          : "for an unobservable claim, restore the recorded checkout path or its lock directory before recovery; nothing here treats uncertainty as absence",
      ].filter((part): part is string => part !== undefined);
      checks.push({
        name: "execution leases",
        ok: true,
        status: "warn",
        detail: `${claims.length} recorded execution claim${
          claims.length === 1 ? "" : "s"
        } observed live: ${parts.join("; ")}${
          counts.length === 0
            ? ""
            : `. Other environments: ${counts.join(", ")}`
        }`,
        fix: fixes.join("; "),
      });
    } else {
      checks.push({
        name: "execution leases",
        ok: true,
        detail: `${environments.length} enrolled environment${
          environments.length === 1 ? "" : "s"
        }: ${list(counts, "none active")}${
          owned.length === 0
            ? ""
            : ". A live owner was observed on each recorded claim; recovery is not needed while it runs"
        }`,
      });
    }
  }

  const recovering = environments.flatMap((record) =>
    record.kind === "environment" && record.data.state.kind === "recovery"
      ? [{
        id: record.id,
        path: record.data.path,
        recovery: record.data.state.recovery,
      }]
      : []
  );
  const claimGaps = queue?.kind === "queue"
    ? queue.data.entries.filter((entry) =>
      entry.state === "active" && !activeClaimFor(entry.candidate_id)
    ).map((entry) => entry.source.effort_id)
    : [];
  if (recovering.length > 0 || claimGaps.length > 0) {
    const parts = [
      ...recovering.map((entry) =>
        `${entry.id} at ${entry.path} stopped in ${entry.recovery.phase}: ${entry.recovery.reason}${
          entry.recovery.children_quiescent
            ? ""
            : " (child processes not yet proved stopped)"
        }`
      ),
      ...claimGaps.map((effort) =>
        `queue reservation for ${effort} has no unexpired claim`
      ),
    ];
    checks.push({
      name: "checkout recovery",
      ok: true,
      status: "warn",
      detail: parts.join("; "),
      fix: `preserve the retained paths, then from the owning worktree run ${
        executionRecoveryCommand("<environment-id>")
      }; it returns the checkout and its queue reservation without validating or landing`,
    });
  } else if (environments.length > 0 || queue !== undefined) {
    checks.push({
      name: "checkout recovery",
      ok: true,
      detail: "no interrupted checkout return or claim gap",
    });
  }

  const retirements = records.flatMap((record) =>
    record.kind === "retirement" && record.data.outcome.kind !== "retired"
      ? [{ id: record.id, outcome: record.data.outcome }]
      : []
  );
  if (retirements.length > 0) {
    const needsRecovery = retirements.some((entry) =>
      entry.outcome.kind === "recovery"
    );
    checks.push({
      name: "landing retirement",
      ok: true,
      ...(needsRecovery ? { status: "warn" as const } : {}),
      detail: retirements.map((entry) =>
        entry.outcome.kind === "pending"
          ? `${entry.id} pending (the accept that landed it finishes cleanup)`
          : entry.outcome.kind === "retained"
          ? `${entry.id} retained for owner-led reconciliation (${entry.outcome.reason})`
          : `${entry.id} needs recovery in ${entry.outcome.recovery.phase}: ${entry.outcome.recovery.reason}`
      ).join("; "),
      ...(needsRecovery
        ? {
          fix:
            "run `discern accept` again from the main checkout; retirement resumes from its recorded step and never repeats the landing",
        }
        : {}),
    });
  }

  const emergencies = (await emergencyValidationStatus(root)).filter((row) =>
    row.state === "outstanding"
  );
  if (emergencies.length > 0) {
    checks.push({
      name: "emergency validation",
      ok: true,
      status: "warn",
      detail: `${emergencies.length} emergency landing${
        emergencies.length === 1 ? "" : "s"
      } still ${
        emergencies.length === 1 ? "has" : "have"
      } validation outstanding: ${
        emergencies.map((row) =>
          `${row.landing_id} at ${
            row.head.slice(0, 12)
          } (${row.exceptions.length} exception${
            row.exceptions.length === 1 ? "" : "s"
          })`
        ).join("; ")
      }`,
      fix: emergencies[0]?.next_action ??
        "run discern done --rerun on the current committed trunk",
    });
  }
  return checks;
}
