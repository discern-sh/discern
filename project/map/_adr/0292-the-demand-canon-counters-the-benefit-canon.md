# ADR 0292: The demand canon counters the benefit canon

**Status**: accepted

## Context

[ADR 0268](0268-the-benefit-canon-transposes-the-feature-registry.md) completed the supply-side account of the product: every feature node is cited by a benefit or recorded absent, every public claim has a benefit-shaped home, and the guards hold both directions. That account is deductive — a benefit is treated as real when its premises are product facts and its conclusion stays within what those facts establish. It can therefore be complete, and it is.

Nothing recorded the demand side: which struggling moments those benefits answer, what the person does about them today, what the struggle costs them, and — critically — the evidence behind each of those beliefs. Demand beliefs lived scattered across the positioning document's human-tension section, the audiences overlay's objections, launch drafts, and conversation: re-derived per surface, never dated, never evidence-tagged, and never accountable to the benefit list. The claims ledger already names the problem without solving it — its hypothesis class is defined as "a plausible audience or market interpretation not yet externally tested" — but no set enumerated those interpretations, so no guard could hold a benefit to one.

The asymmetry matters most now, pre-launch. Every demand belief is currently untested, and launch is the first instrument that can test any of them. A hypothesis that is not recorded before the evidence arrives gets retrofitted to whatever happened; a recorded one can be falsified.

## Decision

**A demand canon counters the benefit canon: a typed registry of evidence-tagged struggling moments, held to two-way coverage against the benefits.**

- `DEMAND_CANON` lives in `scripts/brand/demand.ts` as territories countering each benefit cluster, holding entries. An entry is a struggling moment told from the person's side: the trigger situation, today's alternative (the thing any benefit must beat), the cost in the person's own ledger, the forces at work (push, pull, anxiety, habit), and the segments it is attributed to.
- Every entry carries dated evidence restricted to the claims ledger's market classes — observational, anecdotal, hypothesis, pinned by guard to exactly the ledger's classes below the product-truth pair. `structural` and `demonstrated` describe the product and can never describe the market. An entry is promoted by attaching stronger evidence, never by rewording.
- Coverage runs in both directions, mirroring ADR 0268's guard in reverse: every benefit is answered by at least one entry or recorded in `SUPPLY_PUSH_RECORDS` with its reason — a named bet, exactly one of the two — and every entry cites live benefit ids or records a gap, kept visible as roadmap signal. `tests/demand_canon_test.ts` holds all of it.
- The page compiles through the brand document map into `_internal/brand/demand-canon.md`, and the set enrols in the meta-registry with its guard and membership.

The explicit noes. The canon generates no copy — pieces choose which benefits to lead with and which objections to answer by reading it. It does not replace the audiences overlay, which stays the by-person account in the private tree; the demand canon is the by-moment account, committed, because a coverage guard cannot hold a file absent from contributor checkouts. The benefit canon's own coverage semantics are untouched.

## Consequences

- A new benefit is now three statements: the mechanism it cites (ADR 0268), the value it states, and the demand home that answers it — or a recorded supply-push bet. The two-touch price every closed set pays becomes three-touch for value; accepted for the same reason.
- At introduction the seed is honest about its weakness: all 38 entries rest on hypothesis-class evidence, 43 of 44 benefits are answered, one benefit is recorded supply-push, and one entry records a gap discern does not address. The canon is a falsification sheet for launch, not market validation, and its page says so.
- The demand account is committed and repository-visible, unlike the audiences overlay. Accepted: the entries are evidence-tagged hypotheses about a market, not competitively sensitive by-person strategy, and publishing the discipline is the practice applied to its own marketing.
- Evidence decays by date with no mechanical freshness guard yet. The dates make staleness inspectable; a decay rule, if the seed survives contact with real evidence, is a separate decision.

## Alternatives considered

- **An authored overlay document beside `audiences.md`.** Rejected: no typed guard can hold coverage against a file contributors do not have, and a list nothing enforces is a list that is wrong — the same reason ADR 0175 rejected a hand-written features document.
- **Demand fields on the benefit entries themselves.** Rejected: benefits are deductive and demand is empirical. One entry mixing both lets a struggling moment borrow the certainty of a product fact; separate registries keep the two kinds of claim separately typed and guarded.
- **Waiting for real market evidence before recording anything.** Rejected: the untested hypothesis set is precisely what launch must be instrumented to falsify, and hypotheses recorded after the evidence arrives are predictions in name only.
