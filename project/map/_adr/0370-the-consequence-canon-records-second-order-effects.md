# ADR 0370: The consequence canon records second-order effects above the benefit canons

**Status**: accepted. Extends the benefit canon of [ADR 0268](0268-the-benefit-canon-transposes-the-feature-registry.md) and the demand canon of [ADR 0292](0292-the-demand-canon-counters-the-benefit-canon.md); applies the claim altitudes of [ADR 0244](0244-brand-addresses-the-owner.md) and the evidence classes of [ADR 0270](0270-the-benefit-canon-separates-value-from-claim-qualification.md).

## Context

The benefit canons are first-order and deductive: a benefit is real when its premises are product facts and its conclusion stays inside them. The demand canon is empirical and reasons backward from a struggling moment. Between them the register bridge names a "practical consequence" as a link in its chain, and nothing owned that link. What several benefits do together, over time, and in combination had no record: confidence moving from the agent's account to the project's evidence, failure becoming cheap enough to attempt bolder work, autonomy widening by recorded grant, work running through the hours the person is away. Those were the founder's own reasons for the product, and they lived in conversation and drafts.

A list of second-order benefits drafted against the two benefit canons on September 2, 2026 made the gap concrete. Checked against the ledger, the list held strong consequences beside sentences that crossed recorded boundaries: the review-burden claim's forbidden inference, the refusal to be a sandbox, the map check that judges mechanics only, and the Logbook's metadata-only record. One belief about cheaper and local models appeared four times as if it were four findings. Every bullet had two halves with different evidence rules: a mechanism account that follows from product facts, and a prediction about what people or agents do next, which no product fact can establish.

Two recent decisions shape the answer. ADR 0244 licenses identity words and aspiration in a headline while holding body copy to a hostile literal reading, and ADR 0369 turned the do-not-claim list into a guard that scans every authored surface outside the private overlay, so a boundary that quotes a forbidden sentence to forbid it now fails the Gate.

## Decision

**A consequence canon records second-order effects as a typed registry above the benefit canons. Each entry splits into a deductive consequence and an evidence-classed predicted behavior, and renders at two altitudes.**

- `CONSEQUENCE_CANON` lives in `scripts/brand/consequences.ts` and compiles through the brand document map into `project/map/_internal/brand/consequence-canon.md`. An entry carries a `headline` at the altitude ADR 0244 licenses for headlines, a `consequence` at body altitude that must survive a hostile literal reading, a `then` naming the predicted behavior with dated, sourced evidence, the benefit ids it `restsOn` from its audience's canon, the claim slugs whose strongest public form bounds its wording, a `boundary` naming the nearest forbidden inference, and an optional note. A person entry also names its segments.
- Behavior evidence uses the claims ledger's market classes only, shared with the demand canon. A corroborated behavior cites a recorded demand corpus. A structural or demonstrated class can describe the mechanism half through the cited claims and can never describe the behavior half.
- Evidence is inherited rather than restated. A consequence cites claim slugs, and every claim carries the inspectable basis ADR 0369 introduced, so the mechanism half of a consequence is defended by the same guards without naming a test of its own.
- A belief several entries share is recorded once in `SHARED_HYPOTHESES` and cited by id, following the corpus discipline of ADR 0362, so reuse across entries stays one hypothesis.
- `tests/consequence_canon_test.ts` holds the registry: ids unique and free of benefit, feature, and demand collisions; every cited benefit live in the audience's own canon and every cited claim live in the ledger; evidence dated, sourced, and confined to the market classes; every shared hypothesis resolved and cited; every hypothesis-class behavior labelled on the page and absent from the messaging inventory's fact lines and headline rows; owner-diminishing language refused; every mentioned command a live verb.
- Coverage runs one way. Every consequence rests on at least one benefit; a benefit with no consequence above it is an ordinary benefit and needs no record.
- Boundaries paraphrase. They name a forbidden inference in the ledger's own words and never quote a do-not-claim sentence.
- The canon enrols where the other brand canons enrol: the canonical-sets registry, the brand-documents artifact list, the codegen generated group, the big-picture and commercial-picture map scopes, the shared brand-writing reading foundation, and the manifesto reading path.

## Consequences

- A writing agent has one guarded source for what a page argues over time, and the marketer's line and the mechanism's account live in separate fields rather than competing for one sentence. A headline can be lifted at headline altitude; its consequence supports it at body altitude; its boundary says where the wording stops.
- Adding a consequence costs a benefit citation, a claim citation, a boundary, and classed evidence for the behavior it predicts. That is the intended price, the same three-touch discipline the demand canon pays.
- At introduction the canon holds 35 entries: 19 with observational evidence from this repository and the founder's recorded account, 16 hypotheses, and one shared hypothesis about cheaper and local operators. Like the demand canon at its seeding, it is a falsification sheet for launch rather than market validation, and its page says so.
- Two demand-canon supply-push records, the checkpoint benefit and the briefing export, gain their first demand-side account here. The demand canon's records stand until a struggling moment is authored there.
- Canon Editor does not yet reach the canon; the enrolment is recorded in the project backlog with the files it touches.
- The behavioral halves that cite this repository's records, the five-candidate homepage selection and the founder's several projects under one practice, stay observational on repository evidence. Recording those scenes in the founder's own words is the sweep route the launch narrative already defines.

## Alternatives considered

- **Fold the survivors into the positioning document and the agent canon's cluster introductions.** Rejected: the effects would scatter across prose with no guard, which is the state ADR 0292 corrected for demand.
- **Add consequence fields to the benefit entries themselves.** Rejected: a benefit is first-order and deductive, while a consequence combines several benefits and predicts behavior. One entry mixing both would let a hypothesis borrow the certainty of a product fact, the objection ADR 0292 records.
- **Hold two-way coverage against the benefits.** Rejected: unlike demand, which must answer every benefit or record a bet, a benefit without a second-order effect is unremarkable.
- **One prose altitude per entry.** Rejected: it forced a choice between a line nobody would print and a line the ledger would refuse. ADR 0244 already separates the altitudes; the registry gives each a field.
