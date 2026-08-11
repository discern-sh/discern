# ADR 0270: The benefit canon separates commercial value from claim qualification

**Status**: accepted. Amends [ADR 0268](0268-the-benefit-canon-transposes-the-feature-registry.md).

## Context

ADR 0268 created an outcome-first transposition of the feature registry so creative and product work could begin from benefits instead of reconstructing them from mechanisms. It also required a `caveat` beside every benefit carrying an observationally evidenced public claim. The generated page rendered that qualification directly after the benefit and printed each claim's evidence class in the same paragraph.

That coupling made the canon reliable as a claim-review index and weak as a commercial brief. A drafting agent encountered the limitation at the same moment as the value, treated the evidence class as an instruction to hedge, and reproduced the qualification in work whose first job was to explain why anyone should care. The single `what` field also mixed product mechanism, human consequence, and copy direction. Titles such as “Review the judgment, not the mechanics,” “Pay only for what changed,” and “Leave as cheaply as you came” were technically recoverable from their descriptions but unclear or misleading when lifted into another context.

Commercial value does not always require a measured customer outcome. Product facts can support a direct causal deduction. When the same completed change arrives with its declared tests already run and evidence tied to the commit, establishing whether those tests passed requires less review work than establishing that fact from an unsupported completion message. That conclusion stays true without claiming a universal reduction in total review time, a percentage saving, or independent market validation. The claims ledger still needs stricter evidence classes and forbidden inferences when wording crosses into those broader public claims.

The canon therefore has two distinct jobs to serve: state the genuine human value that follows from the product, and preserve traceability to the mechanisms and public claims that constrain publication. Putting claim-review ceremony inside the benefit prevents the first job from working.

## Decision

The benefit canon becomes discern's internal, commercially ordered account of the product's human value.

Here, internal is a publication boundary rather than a confidentiality promise. The generated page stays out of published documentation surfaces while remaining visible to someone browsing a public source repository. Confidential customer evidence, pricing, market experiments, and other sensitive commercial material belong in a private overlay instead of this canon.

- Every benefit carries a plain-language `title`, a `value` stating what improves for the user, and `whyItFollows` stating the factual or deductive chain from product behavior to that value. Feature citations and claim slugs remain typed traceability data.
- Every cluster declares its commercial role, primary readers, human promise, and commercial value. Cluster order follows the commercial story: ambition and returned attention first; confidence and compounding value next; adoption, differentiation, and trust after the primary case is established.
- A reasoned consequence belongs in the canon when its premises are product facts and its conclusion stays within what those facts establish. Population-wide outcomes, quantified savings, customer behavior, and market validation still require the evidence appropriate to those claims.
- The generated main body renders `value` as **Value**, `whyItFollows` as **Mechanism**, and feature citations as **Product basis**. Claim slugs remain in the traceability appendix. Evidence classes, forbidden inferences, and publication qualifications remain in the claims ledger.
- The `caveat` field and the guard requiring it for observational claims are removed. A replacement guard keeps claim slugs, evidence-class labels, and inline caveats out of the commercial body.
- The canon remains source material. It does not become finished public copy, a substitute for surface-specific strategy, or permission to publish wording beyond the scope of the stated deduction.

ADR 0268's generated transposition, feature coverage, claim coverage, and explicit citations remain in force. This decision replaces its inline-caveat model and its intentionally non-commercial entry shape.

## Consequences

- Strategy, marketing, sales, and copywriting work receives a confident account of why discern matters before it encounters publication review.
- Human value and product substantiation become independently legible. A drafting agent can lead with the former and introduce the latter when a reader needs proof.
- The canon now carries commercial judgment as canonical data. Rewriting a benefit requires deciding its practical consequence, commercial role, and audience rather than paraphrasing a feature.
- Public claim review becomes an explicit later step. A writer who proposes stronger wording must consult the claims ledger instead of expecting the benefit paragraph to carry every possible boundary.
- Structural guards can enforce field completeness, traceability, and register separation. They cannot prove that a value statement is commercially perceptive; that remains a strategy and copy-review responsibility.
- The registry and generated page grow because value and causal support no longer share one compressed sentence. The added length buys a reusable commercial brief rather than a denser feature list.

## Alternatives considered

- **Keep caveats inline and ask drafting agents to ignore them initially.** Rejected because the source still teaches the agent to hedge, and prompt instructions repeatedly lose to nearby canonical text.
- **Maintain a separate hand-written commercial benefits document.** Rejected because it would drift from the feature and claim registries, recreating the unguarded list ADR 0268 removed.
- **Change the evidence class of commercially important claims.** Rejected as a general solution because the claims ledger answers a different question: what exact public wording the available evidence supports. Reclassification cannot supply commercial hierarchy or separate human value from mechanism.
- **Generate a fourth page from the same entries.** Rejected because one benefit would still need two competing prose authorities. Separate fields give the existing projection both registers without creating another canon.
