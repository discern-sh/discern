# ADR 0298: Declaration evidence binds Proof currency and variance authorization

**Status**: accepted; completes the interlock contract of [ADR 0293](0293-checkpoint-declarations-interlock-the-gate.md) at the gate markers of [ADR 0067](0067-accept-validates-the-landed-tree.md)/[ADR 0185](0185-done-refuses-an-unchanged-tree-rerun-without-confirmed.md), the recorded landing authority of [ADR 0194](0194-standing-pre-authorization-is-a-recorded-checked-grant.md), and the durable proof envelope of [ADR 0242](0242-durable-receipts-use-a-versioned-dsse-envelope.md)

## Context

ADR 0293 fixed what a declaration is and that a declared-unmet conclusion needs an owner variance to land, but left three carriers open: how a recorded Proof notices that the agent's conclusions changed underneath it (both gate markers bound only to the tree), how an interrupted landing keeps the owner's variance decision from replaying onto different evidence, and where a later reader finds proof that a declared-unmet checkpoint was authorized rather than pending. Each needed one authoritative home before the verb surfaces and previews could build on them.

## Decision

**The agent's recorded declarations are gate evidence with one identity, and that identity travels with every artifact that vouches for a run: the two gate markers, the acceptance transaction, and the landed proof note.**

- The **declaration-evidence identity** is one timestamp-free hash over the episode store's claims (per checkpoint: episode definition hash and subject, plus the declaration's conclusion, rationale, and binding). An identical re-record is the same evidence; a missing or rebuilt store is the stable empty value; an UNREADABLE store is `unavailable` and every consumer fails open — an uncertain identity is never treated as a changed one.
- Both gate markers record it. The proof marker stales at an unchanged HEAD when the live identity differs — a changed conclusion or rationale invalidates the vouch the way a new commit would — and the last-run marker makes a declaration-changing invocation a DIFFERENT run, so recording a conclusion never needs `--confirmed` while a restored identical claim still reads as the same run.
- Acceptance decides the variance interlock twice: once before any effect (the complete owner decision — `--confirmed` plus one `--variance <id>` per current declared-unmet checkpoint, the id set equal to that set), and again after gate validation, comparing the live declared-unmet bindings (checkpoint, definition hash, subject, rationale) against the authorized set before the fast-forward. A conclusion that changes mid-acceptance refuses with everything intact.
- A variance forces `conversation` consent: recorded grants are not consulted while a declared-unmet conclusion stands. The acceptance transaction journal (version 3) binds the authorized variance set beside its consent; a journal claiming variances under a recorded grant is invalid by construction, and recovery completes only the recorded transition — the decision can never replay onto changed declarations or another tree.
- The landed proof note's DSSE payload gains an `acceptance` block — consent plus the authorized variances — while the six-field durable gate claim stays closed. A later reader distinguishes "declared unmet, awaiting a decision" from "the owner authorized this to land".

## Consequences

- The Proof's three evidence rows are now enforced, not just rendered: machine results bind through the tree, agent declarations through the evidence identity, and owner authority through consent and variances — each staling independently and honestly.
- A green Proof with a declared-unmet conclusion deliberately cannot land until the owner's one complete decision; the refusal serves the criterion, evidence, and rationale, so the decision needs no second retrieval.
- Old markers without the evidence component keep their tree-only semantics until the next run rewrites them — a bounded compatibility window instead of a migration.
- The evidence identity covers the whole store, so a conclusion for a checkpoint that no longer fires still counts toward currency. Harmless: reconciliation is idempotent, and the alternative (a fired-set projection) would let stale store entries drift unnoticed.

## Alternatives considered

- **Stale the Proof through the tree alone.** Rejected: conclusions can change at an unchanged HEAD (that is the point of a revisable judgment), and a Proof that survives a flipped conclusion vouches for evidence that no longer exists.
- **Include timestamps in the evidence identity.** Rejected: identity would then track record instances rather than claims, staling a Proof whose semantic evidence is unchanged and inviting ritual re-declaration.
- **Let a standing grant cover a variance.** Rejected: a grant authorizes a class of routine landings in advance; a variance is a judgment about one named criterion the agent just declared unmet — advance authority for it would be consent to unread evidence.
- **A separate variance ledger outside the journal.** Rejected: the journal already binds one expected-to-target transition with its consent; a second store could disagree with it mid-recovery, which is the failure the journal exists to prevent.
