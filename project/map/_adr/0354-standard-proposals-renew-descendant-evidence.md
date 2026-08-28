# ADR 0354: Standard proposals renew descendant evidence through target-scoped measurement

**Status**: accepted. Amends the exact-commit proposal and shared-measurement decision in [ADR 0339](0339-proposed-standard-limits-and-shared-measurements.md), the pin receipt in [ADR 0106](0106-standards-pin-carries-the-gate-receipt.md), and exact-tree Proof reuse in [ADR 0067](0067-accept-validates-the-landed-tree.md).

## Context

An initial Standard limit proposal creates a config-only commit after measuring its parent. The proposal originally remained live only while that commit was `HEAD`. Any required follow-up commit made it stale, even when the Standard definition, proposed value, reason, and measurement remained unchanged.

The recovery advice told agents to restore the trunk limit before proposing again. Following that advice could create a long sequence of proposal and restoration commits: restore the limit, measure the descendant, propose again, continue the task, then repeat. The Git history changed only to refresh evidence that belongs in worktree-local state. Each cycle could also repeat an expensive Standard measurement.

Named pinning exposed a related selection problem. Names limited which ceilings or floors were rewritten, but the measurement executor still ran every Standard. A prior Gate Proof can establish that the complete clean tree is green while omitting on-demand measurements. The safe useful operation is then to reuse the measured members, run missing named members, and avoid unrelated measurements. Without that whole-tree Proof, narrowing would weaken pin's red-tree refusal because an unselected failing Standard could go unseen.

The integrity boundary therefore needs 2 separate facts: the proposal decision has an immutable origin, while its current measurement evidence can bind to a later descendant; and target selection can narrow execution only when another authority already proves the omitted population.

## Decision

[`buildStandardSelectionPlan`](../../../src/engine/gate/standard_plan.ts) is the shared authority for named Standard operations. It returns the requested targets in configured order, the execution population, and whether execution is target-only. Process grouping consumes the selected execution population afterwards, so selection never duplicates command identity or metric fan-out rules.

`discern standards propose <name> --reason "…"` is a finalization operation. The intended implementation is committed first. The command measures its named Standard through the target-only selection plan, then creates the initial config-only proposal commit when the measured value breaches the unchanged trunk limit. A valid process-backed value already recorded for the same clean `HEAD` may be reused. Dry-run describes the targeted measurement and possible write without running the project command.

A proposal record separates immutable origin from renewable binding. `commit` remains the config-only proposal commit, and `measured_commit` remains its measured parent. `bound_commit` names the current clean descendant whose targeted measurement keeps the proposal live. Proposal identity, Proof equality, acceptance journals, and durable proof notes include that binding.

Repeating the same proposal on its current binding is a no-op. A stale record may renew on a descendant only when:

- the immutable proposal commit is an ancestor and retains its config-only parent relationship;
- the current trunk commit is contained in the descendant;
- the trunk name and limit, Standard direction and normalized definition, proposed limit, signed delta, and verbatim reason are unchanged;
- a new target-scoped measurement equals the recorded measurement and proposed limit; and
- current changed paths still supply responsible evidence under the configured `inputs`.

Renewal writes no project file and creates no commit. It atomically updates `bound_commit`, the equivalent current trunk commit, and recomputed responsible paths in worktree-local administration state. It clears prior Gate Proof, so the descendant must pass `discern done` before acceptance. A changed tuple, value, definition, ancestry, or attribution refuses; the record authorizes nothing, and creating a different proposal starts by restoring the trunk limit.

Pre-rebinding proposal stores, structured Proof, and interrupted acceptance journals normalize an absent `bound_commit` to `commit`. New results and persisted records always emit the current field.

A named `discern standards --pin` changes only its requested limits. It narrows measurement execution to those targets only when an honored Gate Proof validates the complete current clean `HEAD`. Same-commit measurements are reused per Standard, and missing selected members run through normal shared process grouping. Without honored Gate Proof, the executor validates the complete Standard set before changing the requested limits. An unselected red Standard therefore still blocks pinning in the unproved case.

Project-authored tests that require a live registry to equal a configured limit remain a separate configuration cycle. Descendant proposal renewal and pin selection do not bypass or reinterpret those project commands.

## Consequences

- Agents can finish implementation before creating a proposal. Required descendant work no longer produces alternating proposal and restoration commits when the decision and measurement remain unchanged.
- Renewal still pays for the named measurement. That cost is required evidence that the descendant preserves the proposed value; unrelated Standards do not run.
- The immutable proposal commit remains auditable in history, while the current binding remains local until Gate Proof and acceptance make it durable.
- Pin can avoid unrelated on-demand work after the complete tree is proved. Before that proof exists, its previous whole-set safety property remains intact.
- Proposal and Proof records gain one required field in new output. Compatibility readers must normalize the short-lived earlier record rather than treating it as malformed.
- The target-selection planner becomes another canonical set boundary. New Standard names enroll automatically; future named operations must consume it instead of filtering independently.

## Alternatives considered

- **Create another proposal commit on every descendant.** Rejected because the decision is unchanged and Git history would record evidence renewal as project change.
- **Amend or replace the original proposal commit.** Rejected because existing descendants, prior evidence, and review references rely on its immutable identity.
- **Trust the old measurement on any descendant.** Rejected because a later change can alter the metric without changing the configured Standard tuple.
- **Always narrow a named pin to its targets.** Rejected because an unselected failing Standard could then be omitted from the only validation preceding a limit commit.
- **Always remeasure every Standard.** Rejected because honored whole-tree Proof already establishes the omitted members, and on-demand Standards can make the duplicate pass expensive.
