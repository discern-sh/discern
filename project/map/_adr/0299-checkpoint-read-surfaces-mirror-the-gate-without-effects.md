# ADR 0299: Checkpoint read surfaces mirror the gate without effects

**Status**: accepted; builds the read surface of [ADR 0293](0293-checkpoint-declarations-interlock-the-gate.md)'s contract on the governing policy of [ADR 0294](0294-the-merge-base-governs-checkpoint-policy.md), the `when` boundary of [ADR 0296](0296-when-delegates-trigger-conditions-under-a-v1-boundary.md), and the evidence bindings of [ADR 0298](0298-declaration-evidence-binds-proof-currency-and-variance-authorization.md)

## Context

The interlock exists but could only be experienced by colliding with it: the first sighting of a question was the `done` refusal, and the only account of an effort's declaration state was inside a gate run. Agents needed the questions early in the inner loop, and owners needed one command answering what governs, what state the effort is in, what would fire, and which declared-unmet conclusions still await a variance. Every candidate surface is a read — and a read that executed project code, wrote an open question, or disagreed with what `done` would actually do would be worse than none.

## Decision

**Checkpoints get one strict-obligation inspection, projected everywhere, and one read verb that reports the state `done` and `accept` would act on — with no effect of any kind.**

- **One inspection, many projections.** `inspectCheckpointObligations` joins the governing policy, current structural outcomes, readable persisted open questions, projected subject currency, and declarations into one decision state per governing checkpoint. Plan notes for `done --dry-run`, advisory hints for `prepare` and `status`, report rows for `discern checkpoints`, and the strict preflight all consume that inspection. Structural preview remains evidence beside the decision; it is not the decision itself.
- **Persisted questions outrank idle triggers.** A trigger opens an open question but does not own its lifetime. Once a governed `stop` question is readable in the effort store, a later structural veto or passing `when` cannot retract it. The inspection therefore projects that question as awaiting, reopened, declared met, or declared unmet even while its current structural preview is idle. A settled structural fire without a stored question projects `will_open`; an ungoverned historical question remains visible but does not interlock.
- **`discern checkpoints` is the contract's detailed read surface** — CLI, `--json`, `--markdown`, and MCP `discern_checkpoints`, one shared core. It reports the governing policy (question, trigger summary, mode, policy identity), each row's canonical `obligation`, the structural preview, open-question evidence, and any recorded open question the governing policy does not contain. The envelope is always `ok`: this is an account of state, and every uncertainty (unresolvable policy, unreadable diff or store, a pending `when`, a subject that cannot be computed) projects `unknown` with an advisory or “may require” account rather than a refusal.
- **Declaration currency mirrors gate reconciliation.** Every readable governed open question gets its current definition hash and subject fingerprint recomputed read-only, including one whose trigger is now dormant. A differing binding projects `reopened` with `declaration.current: false`; a matching binding carries its recorded conclusion. A pending `when` that could change a standing conclusion's subject stays `unknown` because a read surface never executes project code.
- **Strict execution inspects, then reconciles once.** Bare `done` begins from the same inspection, resolves any pending `when`, and performs the existing open-question and declaration writes once. The pure active-state classifier is shared by the read projection and mutating preflight, while invalid declaration requests remain all-or-nothing.
- **The read surface routes, it never authorizes.** An awaiting question is routed to the two valid `done` conclusions (`--met`, or `--unmet --why`); a current declared-unmet conclusion is routed to the owner's variance review at `accept`. No read surface presents `--variance` as work the agent performs.
- **Observed economics stay outside the decision.** `observedCheckpointEconomics` reads the Logbook through one named seam. Its counts may inform policy review, but never feed an obligation or refusal.

## Consequences

- An agent learns of a coming or already-open declaration at `prepare` time and can judge the question while the change is hot; the `done` refusal becomes confirmation, not news.
- A conclusion the next gate run would unbind is never reported as standing, even after the structural trigger becomes idle — at the cost of a few extra read-only Git operations per governed open question.
- `prepare` and `status` each gained a small fixed number of Git reads (merge-base, governing config, effort diff) even in checkpoint-free projects; a checkpoint-free effort still renders zero additional output.
- The preview cannot see through `when`: a `when`-gated checkpoint previews as "may require" rather than a certainty, which is the honest limit of a surface forbidden to execute project code.

## Alternatives considered

- **Let structural preview define the obligation.** Rejected: a trigger opens a question but cannot close it, so an idle preview may coexist with a persisted question strict `done` must still interlock.
- **Report the store's own currency untouched.** Rejected: after a relevant edit, the store can still claim a conclusion that the next `done` will unbind — precisely the wrong answer to "what state is my effort in".
- **Run `when` commands in the read verb for an exact preview.** Rejected: read verbs run none of the project's commands — a guarantee documented to users — and the `when` boundary already makes execution a gate-time act.
- **A per-surface preview computation.** Rejected: three independently-evolved previews is how `prepare`, `status`, and `--dry-run` come to disagree about what fires.
- **Ship a placeholder economics block in the wire schema now.** Rejected: the observation workstream owns the event vocabulary; a guessed shape would either constrain it or ship dead wire fields. The named function seam defers the shape to the work that defines it.
