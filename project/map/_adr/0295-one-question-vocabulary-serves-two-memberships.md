# ADR 0295: One question vocabulary serves the improvement and checkpoint memberships

**Status**: accepted; refactors the subjective half of `improvement`'s catalog behind [ADR 0293](0293-checkpoint-declarations-interlock-the-gate.md)'s questions

## Context

The improvement catalog already carried exactly the shape a checkpoint serves: a stable id, judgment prose the agent evaluates, and a `teach`. Checkpoints needed the same material at a different moment — a diff boundary instead of an estate audit. Duplicating the prose would guarantee drift between "what review asks" and "what the gate asks"; keeping it inside the improvement catalog would make `improvement` the accidental authority over gate behaviour.

## Decision

**The judgment prose is one canonical vocabulary; WHERE it is evaluated is a membership decision.**

- `src/shared/questions.ts` holds the canonical **question**: id, question prose, teach, optional reference. Prose lives there once.
- The **improvement membership** (`engine/improve/rules.ts`) references questions by id and contributes the estate-review framing: a display title and the `against` evidence resolver. A membership serves the canonical prose verbatim; construction fails on a dangling id.
- The **checkpoint membership** (`shared/checkpoints.ts`) pairs a question with a shipped trigger seed — a built-in checkpoint a project enables by declaring its id, with its own fields overriding the seed's. The registry ships empty until the built-in set lands; its parity guard already walks it.
- Parity guards drive off the single sources (`tests/questions_registry_test.ts`): every membership reference resolves, memberships carry the canonical prose byte-for-byte, and no question is orphaned by every membership. "This question blocks `done`" is therefore an explicit membership decision, never a side effect of a field on the question.
- The conversion rule between the two memberships: a question becomes a checkpoint **exactly when its violations are introduced by diffs**; violations that accrue by time or absence (staleness, navigability, missing standards) stay audit-side. The placement ladder stands above both: shaping-every-decision prose → instructions; a recurring method → a skill; caught as a narrow change completes → a checkpoint; mechanically decidable → a gate job or standard; requiring owner authority → consent or a grant.
- A project-authored checkpoint still authors question and membership in one TOML table — the separation is structural, not a user-facing ceremony.

## Consequences

- The same judgment reads identically in an estate review and at a gate refusal, and a wording improvement lands in one file.
- One vocabulary entry (`gate.structured-diagnostics`) interpolates the live diagnostic-format registry from the engine layer, so the prose can never drift from what the gate recognizes; the shared module carries that one downward-looking import deliberately.
- `improvement`'s behaviour and renderings are unchanged — its registry became the improvement membership without moving a byte of served prose.

## Alternatives considered

- **Copy the prose into a checkpoint-side table.** Rejected: two sources for one judgment is the textbook drift.
- **Make the improvement catalog the authority and import it from checkpoints.** Rejected: it bundles estate-review framing (weights, categories, evidence resolvers) that gate machinery must not depend on, and it inverts ownership — vocabulary is shared; frames are members.
- **A `blocks_done` field on the question itself.** Rejected: it would make blocking a property of prose rather than a recorded membership decision, and every question edit would become a gate-policy edit.
