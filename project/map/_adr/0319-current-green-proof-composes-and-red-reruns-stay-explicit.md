# ADR 0319: Current green Proof composes and red reruns stay explicit

> **Amendment (2026-09-03).** Before v1, the project confirmed that no public caller depends on the provisional `done --confirmed` spelling. Gate reruns now accept only `--rerun`; `--confirmed` remains reserved for consent-bearing operations. Historical Logbook events with a `confirmed` flag remain readable evidence. This reverses the compatibility-alias bullet, its consequences, and the corresponding rejected alternative below; the exact-state reuse and retry-resistance decision is unchanged.
>
> - **Accepted completion-model direction (2026-09-05):** [ADR 0374](0374-complete-proof-is-independent-of-measurement-scheduling.md) binds aggregate Proof to a complete candidate requirement set while allowing valid component reuse. This accepted extension has implementation pending.

**Status**: accepted; supersedes [ADR 0185](_superseded/0185-done-refuses-an-unchanged-tree-rerun-without-confirmed.md).

The decision retains ADR 0185's last-run marker and retry-resistance boundary while preserving the exact Proof identity of [ADR 0313](0313-setup-completion-and-acceptance-bind-one-final-proof.md) and declaration-evidence currency of [ADR 0298](0298-declaration-evidence-binds-proof-currency-and-variance-authorization.md).

## Context

ADR 0185 made an identical-tree `done` invocation refuse before Gate work. That closed retry-until-green: the last-run marker remembers red as well as green, independently of the advisory Logbook. It also made a repeated green invocation refuse, on the reasoning that `status` already held the answer.

That second behavior is safe for a person at a terminal but awkward for command composition. A project's aggregate command can run `discern done`, and setup completion or another wrapper can later reach the same Gate on the unchanged tree. The wrapper does not need another measurement. It needs the current answer. Returning an error forces special-case recovery even when discern already holds exact, canonical, strict green Proof.

The optimization is valid only for current evidence. A last-run marker that says green is not itself Proof: the structured marker may be missing, unreadable, stale, report-only, dirty, internally incoherent, or bound to different checkpoint declarations. Red also must remain non-negotiable. A caller cannot gain a passing result merely by repetition.

The preferred escape spelling also carried the wrong concept. `--confirmed` already expresses setup-consent attestation and owner landing consent. An explicit repeat Gate measurement is neither. Compatibility matters because existing scripts may already call `done --confirmed`, but new guidance should name the actual operation.

## Decision

**An ordinary identical-state `done` returns canonical current green Proof without running the Gate. Every other identical-state rerun still refuses until it is requested explicitly.**

- The unchanged-state branch calls the canonical Proof inspector. Reuse requires complete, current-format, strict, clean Proof for the exact `HEAD`, working-state identity, checkpoint declaration evidence, and Standard definitions. Evidence with an indeterminate stop or unavailable Gate strand is not reusable. The configured local trunk must be readable and the branch must not be behind it; Proof does not bind a trunk SHA. The result returns the same structured Proof and relay line with `data.gate_ran = false`.
- Proof reuse runs before fixers, tracked refresh, jobs, Standards, and checkpoint mutation. It performs none of them and creates no replacement evidence. Human, Markdown, JSON, and Model Context Protocol (MCP) projections derive from the same success result and state mechanically that no Gate job ran.
- An unchanged red verdict refuses read-only. A green last-run marker whose canonical Proof is missing, unreadable, stale, dirty, report-only, or declaration-stale also refuses. The marker never substitutes for Proof.
- `discern done --rerun` is the Gate-specific option for an explicit same-state measurement or environment-only retry. It bypasses reuse and refusal, executes one ordinary Gate run, and records `rerun` in the Logbook flags so same-state divergence remains attributable.
- `discern done --confirmed` is not a compatibility alias. Gate reruns accept only `--rerun`; `--confirmed` remains reserved for consent-bearing setup and acceptance operations. Historical Logbook events with a `confirmed` flag remain readable evidence.
- A changed tree or changed checkpoint evidence follows the normal Gate path. `--dry-run` remains read-only plan rendering: it neither reuses nor creates Proof and does not update the last-run marker.

## Consequences

- An aggregate command and a later setup or lifecycle wrapper can compose cheaply with the same exact green answer. The second call is successful but truthfully reports that it did no Gate work.
- Retry resistance remains asymmetric by design: green exact evidence is reusable; red, ambiguous, stale, or incomplete evidence is not. Repetition never heals a failure.
- `gate_ran` becomes a typed public and Logbook fact. Callers no longer infer execution from duration, steps, or prose.
- Gate automation has one explicit retry spelling, `done --rerun`, separating repeat measurement from owner and setup consent.
- Same-state flake analysis keeps its evidence because explicit reruns are recorded distinctly under either spelling.
- Canonical Proof validation is now both the landing fast path and the composition fast path. Any future Proof identity field automatically constrains reuse through that one validator rather than a parallel cache predicate.

## Alternatives considered

- **Keep refusing every identical state.** Rejected because a wrapper asking for an answer already held must handle success as failure or pay for a deliberate full rerun.
- **Trust the green last-run verdict without inspecting Proof.** Rejected because the last-run marker does not carry the complete evidence required for review or setup landing.
- **Rerun an unchanged green tree automatically.** Rejected because it spends project time without adding evidence and recreates the original composition loop.
- **Make unchanged red idempotently successful.** Rejected because it destroys the anti-flake boundary: a caller could turn failure into success by repetition.
- **Retain `done --confirmed` as an alias.** Rejected before v1 because it conflates repeat measurement with current-conversation consent; historical Logbook data remains readable without preserving the CLI ambiguity.
