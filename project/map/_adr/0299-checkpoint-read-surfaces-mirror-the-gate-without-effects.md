# ADR 0299: Checkpoint read surfaces mirror the gate without effects

**Status**: accepted; builds the read surface of [ADR 0293](0293-checkpoint-declarations-interlock-the-gate.md)'s contract on the governing policy of [ADR 0294](0294-the-merge-base-governs-checkpoint-policy.md), the `when` boundary of [ADR 0296](0296-when-delegates-trigger-conditions-under-a-v1-boundary.md), and the evidence bindings of [ADR 0298](0298-declaration-evidence-binds-proof-currency-and-variance-authorization.md)

## Context

The interlock exists but could only be experienced by colliding with it: the first sighting of a question was the `done` refusal, and the only account of an effort's declaration state was inside a gate run. Agents needed the questions early in the inner loop, and owners needed one command answering what governs, what state the effort is in, what would fire, and which declared-unmet conclusions still await a variance. Every candidate surface is a read — and a read that executed project code, wrote an episode, or disagreed with what `done` would actually do would be worse than none.

## Decision

**Checkpoints get one structural preview, projected everywhere, and one read verb that reports the state `done` and `accept` would act on — with no effect of any kind.**

- **One preview, many projections.** The structural trigger evaluation against the current diff is computed once (`previewCheckpoints`) and projected per surface: plan notes for `done --dry-run`, advisory hints for `prepare` and `status`, and report rows for `discern checkpoints`. The surfaces stay consistent by construction, not by copied logic. A preview is structural only: it never runs a `when` command (an undecided condition is reported as "may require") and never touches the episode store.
- **`discern checkpoints` is the contract's read surface** — CLI, `--json`, `--markdown`, and MCP `discern_checkpoints`, one shared core. It reports the governing policy (question, trigger summary, mode, policy identity), each episode's declaration state, the structural preview, and any recorded episode the governing policy does not contain. The envelope is always `ok`: this is an account of state, and every uncertainty (unresolvable policy, unreadable diff or store, a subject that cannot be computed) degrades to an advisory rather than a refusal.
- **Declaration currency mirrors gate reconciliation.** Where a bare `done` would reconcile an episode — a settled `stop` firing with no `when` pending — the report recomputes the current definition hash and subject fingerprint read-only, and reports a differing binding as `reopened` with `declaration.current: false`. Where `done` would not reconcile (a dormant trigger, a pending `when`), the recorded binding is authoritative — the same read acceptance makes. The report therefore answers "what happens next at the gate", not "what does the store file contain".
- **The read surface routes, it never authorizes.** An awaiting question is routed to the two valid `done` conclusions (`--met`, or `--unmet --why`); a current declared-unmet conclusion is routed to the owner's variance review at `accept`. No read surface presents `--variance` as work the agent performs.
- **Observed economics arrive later through one named seam.** The logbook records no checkpoint events yet, so the report states "no observed checkpoint history yet"; `observedCheckpointEconomics` is the single function the observation work fills, with the renderings already branching on it.

## Consequences

- An agent learns of a coming declaration at `prepare` time and can judge the question while the change is hot; the `done` refusal becomes confirmation, not news.
- A conclusion the next gate run would unbind is never reported as standing — at the cost of a few extra read-only Git operations per recorded episode whose trigger currently holds.
- `prepare` and `status` each gained a small fixed number of Git reads (merge-base, governing config, effort diff) even in checkpoint-free projects; a checkpoint-free effort still renders zero additional output.
- The preview cannot see through `when`: a `when`-gated checkpoint previews as "may require" rather than a certainty, which is the honest limit of a surface forbidden to execute project code.

## Alternatives considered

- **Report the store's own currency untouched.** Rejected: after a relevant edit, the store still claims a current conclusion that the next `done` will unbind — precisely the wrong answer to "what state is my effort in".
- **Run `when` commands in the read verb for an exact preview.** Rejected: read verbs run none of the project's commands — a guarantee documented to users — and the `when` boundary already makes execution a gate-time act.
- **A per-surface preview computation.** Rejected: three independently-evolved previews is how `prepare`, `status`, and `--dry-run` come to disagree about what fires.
- **Ship a placeholder economics block in the wire schema now.** Rejected: the observation workstream owns the event vocabulary; a guessed shape would either constrain it or ship dead wire fields. The named function seam defers the shape to the work that defines it.
