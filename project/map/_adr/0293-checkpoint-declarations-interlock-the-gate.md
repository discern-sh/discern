# ADR 0293: Checkpoint declarations interlock the gate through open questions and relevance-sensitive subjects

**Status**: accepted; sits beside the machine checks of [ADR 0133](0133-standards-join-the-gate.md), the rerun guard of [ADR 0185](0185-done-refuses-an-unchanged-tree-rerun-without-confirmed.md), and the consent record of [ADR 0134](0134-accept-attests-consent.md), without joining the consent-gated class

## Context

discern's quality model verified two kinds of evidence: machine facts (gate jobs, standards) and owner authority (acceptance and its grants). Nothing carried the middle kind — a judgment only the agent in the loop can make, delivered at the moment a diff makes it relevant, with the conclusion recorded. Estate-wide review (`improvement`) audits what already exists; nothing stopped a new violation at the boundary of one change. A question that no machine can decide cannot become a gate job, and pretending otherwise would put a model call or a fake verdict inside a reproducible gate.

## Decision

**A checkpoint is a deterministic, change-triggered requirement for the agent to judge a named question and record a conclusion before the gate runs; the record is agent evidence, never a machine verdict.**

- A `stop` checkpoint whose trigger is active refuses `discern done` before any gate job until the agent declares the question **met**, or **unmet with a short rationale**. The declaration is required; its semantic truth is not verified. Every surface says "declared met" / "declared unmet" — never bare "passed" or "verified" — and the word "attestation" is reserved for a planned signed-statement feature.
- The conclusion is one exhaustive union: `met`, or `unmet` plus a rationale (trimmed, one paragraph, 1–500 characters, no control characters, validated before any write). The rationale is opaque evidence: never executed, never interpreted as policy, rendered only through standard escaping boundaries, and kept out of the metadata-only logbook.
- A declared-unmet checkpoint lets the gate run but requires an owner-authorized **variance** to land — bound to the declaration and the landed tree, never to future efforts. Standing and effort grants never cover a variance. Landing authority stays a separate evidence kind; checkpoints do not join the consent registry because a declaration is the caller's own act, not the owner's.
- The record that a checkpoint fired is an **open question**: effort-scoped state in the per-worktree Git administrative area (the registered `checkpointEpisodes` entry), surviving session restarts and vanishing with the worktree. An open question is the only thing a declaration can act on — ids are public config; the open question, not secrecy, forces the question-serving moment.
- A declaration binds to a **subject**: the checkpoint's definition hash plus each sorted matched path's base and current mode/blob (or absence), with dirty and untracked content hashed through git's own content addressing and renames kept as a deletion plus an addition. Reopening is therefore relevance-sensitive: unrelated branch edits and unrelated trunk updates leave a declaration current; any change to matched content, the matched set, or the definition reopens it. Every store and subject operation is idempotent per (checkpoint, subject, declaration evidence).
- Everything fails OPEN on uncertainty — unreadable state, a corrupt store, a subject that cannot be computed — with an advisory; a refusal must never wedge an effort.

## Consequences

- The proof gains a third, lexically distinct evidence row: machine results, agent declarations, owner authority. Consumers can trust each row for exactly what it claims.
- A declaration survives new sessions and restarts but not relevance: revising the matched change re-asks the question. That is the point, and the cost — an agent may re-declare after every relevant revision.
- The gate stays reproducible and model-free: triggers are mechanical facts about the diff; the only intelligence involved is the agent's, and its output is recorded rather than trusted.
- The interlock, previews, verb surface, and acceptance wiring build on these primitives in later workstreams; this record fixes the contract they compose.

## Alternatives considered

- **Verify declarations with a model call inside the gate.** Rejected: the gate must stay deterministic, offline, and cacheable; a probabilistic verdict would counterfeit the machine-evidence row.
- **Bind declarations to the whole tree (HEAD) instead of subjects.** Rejected: every unrelated edit would stale every declaration, training agents to repeat declarations ritually — the opposite of judgment.
- **Advisory-only conclusions (never block).** Rejected as the only mode: an advisory is ignorable at exactly the moment it matters; `advise` exists, but the default mode makes the judgment unavoidable while leaving the verdict honest.
