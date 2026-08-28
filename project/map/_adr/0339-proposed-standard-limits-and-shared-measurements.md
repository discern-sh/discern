# ADR 0339: Proposed Standard limits require exact approval and identical measurements share one run

> **Amended by [ADR 0354](0354-standard-proposals-renew-descendant-evidence.md):** the proposal commit remains the immutable origin, while unchanged targeted measurement evidence can renew the live binding on an eligible descendant. Named Standard operations share one selection plan; pin narrows measurement only when current Gate Proof already validates the complete clean tree.

**Status**: accepted. Extends the breach escalation in [ADR 0161](0161-growth-proof-standards-and-breach-escalation.md) and shared Standard pipeline in [ADR 0155](0155-standalone-standards-share-the-gate-job-pipeline.md). It also extends normalized definitions in [ADR 0323](0323-standards-hold-normalized-enforcement-definitions.md), Proof-gated acceptance in [ADR 0067](0067-accept-validates-the-landed-tree.md), and conversation consent in [ADR 0134](0134-accept-attests-consent.md).

## Context

A Standard breach caused by the work had no completion transaction. The branch could restore the held number, ask for a separate limit edit on the trunk, or reduce the metric through unrelated work. The trunk edit sat outside the branch and its Proof. Unrelated reductions obscured the change that moved the metric. Neither route presented the owner with one commit-bound decision at the landing boundary.

Standards also planned one process job per entry. A single instrumented command can emit several `DISCERN_METRIC` readings, but 2 Standards using that command ran the full process twice. A cache inside the metric command would hide execution policy from the Gate and split timeout, cancellation, and failure behavior across 2 authorities.

The proposed-limit decision needs narrower authority than landing. A green Proof, standing scope grant, effort grant, generic conversation consent, checkpoint variance, or earlier Standard approval cannot establish that the owner accepted a specific Standard, value, and reason.

## Decision

Runnable Standards with the same process execution identity share one process run. The identity contains the normalized command, checkout root, and effective timeout. Invocation-wide shell, environment, streaming, and cancellation policy is common to the measurement plan. A future process-affecting option must join the identity before Standards using different values can share.

The plan groups only members whose resolved action is `measure`. Replayed and deferred Standards keep those actions even when another Standard measures the same command. Each dependent Standard evaluates the shared stdout separately. Metric selection, rate denominators, limit comparison, result steps, diagnostics, and pin eligibility remain separate. A missing metric fails its Standard. A failed process fails every Standard that depended on that run. Each dependent reading records the shared process duration.

A breach caused by the current change uses `discern standards propose <name> --reason "…"`. The command requires a clean worktree branch and fresh process-backed evidence for the current `HEAD`. The measured value must breach the unchanged trunk limit in the configured direction. The Standard must declare `inputs`, and at least one changed path must match those inputs. The reason remains verbatim after validation as one visible paragraph of 1–500 characters without an obvious secret.

The proposal executor follows the plan/apply boundary. It probes every write target, journals the transition, changes the Standard limit to the measured value, and creates a config-only commit whose parent is the measured commit. It then records the proposal in worktree-local Git administration state. Recovery restores a pre-commit edit or finalizes a completed proposal commit. Repeating the same request makes no change. A reason-only replacement updates the proposal record and invalidates prior Proof without creating another commit.

The versioned proposal store is the authority for pending decisions. Each record contains the Standard name, proposal commit, measured commit, normalized definition fingerprint, trunk name and commit, direction, trunk limit, proposed limit, measurement, signed delta, verbatim reason, and responsible paths. A record is active only while current `HEAD`, the trunk baseline, the Standard definition, the config-only parent relationship, responsible-input coverage, and fresh measurement all match. Stale or absent records authorize nothing. A proposal for one Standard does not cover another breach.

The Gate treats an active proposal as the only explanation for the otherwise-forbidden limit change. It forces that Standard to measure even when normal policy would replay or defer it, and the new reading must equal the recorded measurement. A green Proof carries each proposal before routine Standard results and states that owner approval remains required. Proof reuse and unchanged-tree run identity include the live proposal set, so a reason change, revocation, trunk movement, or changed measurement requires another Gate judgment.

Acceptance requires the live proposal store and the honored Proof to match. It serves one 64-character lowercase hexadecimal token derived from the Standard name, proposed limit, and verbatim reason. The token is an exact relay handle, not an authority source: a copied approval command stops matching when any tuple changes. The owner approves the current set with `discern accept --confirmed --approve-standard <token>`, repeating the flag for each proposal. The supplied token set must equal the current proposal set. Generic landing authority and checkpoint variance authority do not satisfy this check.

An approved acceptance fast-forwards the proposal commit already named by Proof. Acceptance does not edit the limit or add a commit after Proof. The acceptance journal and proof note retain the approved proposal records. Successful worktree removal consumes the local proposal store. A declined decision leaves every checkout and ref unchanged. Restore the trunk limit in the branch and run `discern done` under ordinary enforcement.

## Consequences

- One expensive measurement can serve several metrics while each Standard keeps its own enforcement result.
- Proposal creation adds a config-only commit before the final Gate. That commit makes the proposed limit part of the exact tree reviewed and landed.
- Standards without accurate `inputs` cannot use the proposal transaction because discern cannot name responsible files.
- Proposal state stays local to the worktree until Proof and acceptance make it durable. Removing the worktree removes any unconsumed proposal state.
- The public result and proof-note schemas gain additive proposal and approval fields. Existing v1 readers continue accepting additive fields. Consumers that exhaustively project known fields need an update.
- The approval token is a relay handle without cryptographic signature semantics. `--confirmed` attests that the current conversation approved the tuple the token identifies.

## Alternatives considered

- **Change the limit during acceptance.** Rejected because the landed tree would differ from the commit that passed the Gate.
- **Let generic landing authority cover a proposed Standard limit.** Rejected because scope coverage says who may land a change; it does not record approval of a Standard, value, and reason.
- **Keep the owner edit on the trunk.** Rejected because the branch Proof and landing transaction would omit the limit decision caused by that branch.
- **Cache inside the metric command.** Rejected because scripts would own process reuse, invalidation, and failure policy outside the measurement plan.
- **Track a proposal file in the repository.** Rejected because pending authority belongs to one worktree and must disappear when that effort ends. Proof and the proof note preserve the approved decision.
