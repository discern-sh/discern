# ADR 0268: The benefit canon transposes the feature registry

**Status**: accepted; **amended by [ADR 0270](0270-the-benefit-canon-separates-value-from-claim-qualification.md)**, which replaces inline benefit caveats with a separate commercial-value and causal-support register.

## Context

[ADR 0175](0175-the-feature-canon-compiles-from-a-feature-registry.md) made features and benefits one registry so launch work could stop re-deriving "what does discern offer" by hand — and it anticipated benefits explicitly: `kind: "benefit"` marks a node whose statement is value rather than mechanism, and a benefit "can exist at levels of abstraction no single mechanism owns."

The anticipation never became an account. The tree is organized by mechanism — ten subsystem pillars — so a benefit statement exists only where a mechanism happens to anchor one: `why` is optional, and the eleven benefit nodes that exist all sit under Foundations, the one pillar whose statements had no mechanism to attach to. Nothing composes value across pillars, though the real benefits cut across them — "stop relaying messages between agents" draws on `await`, a bundled skill, and the landed evidence at once. Nothing groups benefits by the human outcome they serve. And nothing forces a new capability to state what it buys anyone: the enrolment guards hold every closed-set member to a feature claim, but no guard holds any feature to a benefit. Clarity about value stayed permitted, never required — so the outcome-first account kept being re-derived in strategy drafts, homepage copy, and conversation, at a different resolution and with a different subset missing each time. That is the exact failure mode ADR 0175 cured for mechanisms, still live for benefits.

A second authority has meanwhile matured beside the canon: the public claims ledger (`scripts/brand/claims.ts`) fixes each public claim's strongest defensible wording, evidence class, and forbidden inference. The two were unlinked — a benefit statement in the canon could not say which public claim it backs, so qualifiers (an observational evidence class, a scope condition) traveled by review memory rather than mechanically.

## Decision

**The registry gains a benefit canon: an outcome-first transposition in the same module, compiled to a third generated page, with coverage guards in both directions.**

- `BENEFIT_CANON` is a second, small tree in `scripts/feature_registry.ts`: clusters (human outcomes) holding benefit entries. An entry carries a verb-phrase `title` addressed to the owner, a factual `what`, `drawsOn` — explicit citations of feature-node ids, the same explicit-key discipline `surfaces` uses — optional `claims` naming ledger slugs (`ClaimSlug`, so a retired claim fails the type-check), and an optional `caveat` that quoting copy must carry.
- codegen renders `_internal/feature-canon-benefits.md`: the clusters, each benefit beside the titles of the features it draws on, its claims, and its caveat. Same tier, banner, and sync discipline as the canon's other two pages.
- Coverage is guarded in both directions. Every feature node is cited by at least one benefit's `drawsOn` or recorded in a deliberate-absence table with its reason — exactly one of the two — so a new capability cannot land without someone stating what it buys a person. Every ledger claim is carried by at least one benefit, so public wording always has a benefit-shaped home. A stranded citation — a feature id or claim slug that no longer exists — fails the gate.
- A `caveat` is mechanically required wherever a cited claim's evidence includes the observational class, so the wording constraint rides the citation instead of the reviewer's memory.
- The benefit canon is its own canonical set in the meta-registry, declaring its guard test and generated artifact.

The explicit noes. The mechanism tree is untouched: pillars stay subsystem-organized, the existing benefit nodes stay where their statements anchor, and the existing pages change only their cross-reference line. Benefit entries carry no plain-language axis — the plain canon retells feature accounts, and extending it to the transposition is a separate decision. The canon still generates no copy: pieces quote it, the voice pass supplies register, and naming stays with the glossary canon — ADR 0175's boundaries, unchanged.

## Consequences

- A new feature is now two statements — the mechanism, and the benefit that cites it or a recorded absence. The same deliberate two-touch price every closed set already pays, applied to value.
- At introduction, every feature node is cited by at least one benefit and the absence table is empty; all twenty ledger claims resolve to benefit homes. The guards hold both facts from here on.
- Creative and product work reads outcomes at outcome altitude with mechanism citations attached; a claim's qualifier arrives with the benefit that cites it.
- The transposition doubles where a feature's value appears — its node-local `why` and any benefit citing it. Accepted: the `why` is the anchored statement, the benefit is the cross-cutting composition, and both are held to live ids by the guards.
- The registry, already large by design, grows again — and remains the one place to read the entire product.

## Alternatives considered

- **Reorganize the canon's pillars around outcomes.** Rejected: the mechanism reading is what the manual, engineering work, and the closed-set coverage appendix need. A transposition-by-projection yields both readings from one source.
- **A hand-written benefits page beside the canon.** Rejected for the reason ADR 0175 rejected a hand-written features document: a list nothing enforces is a list that is wrong.
- **Extend the in-tree benefit nodes with a cluster field.** Rejected: cross-pillar composition is the point. Forcing benefits to live inside the mechanism hierarchy is what kept them from being written.
- **Publish the page.** Rejected, as ADR 0175 rejected publishing the canon: editorial surfaces remain projections of it, and readers keep one product account.
