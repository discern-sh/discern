# ADR 0369: Public claims and refusals bind to cited guards

**Status**: accepted. Extends the Boundary Canon's evidence model in [ADR 0305](0305-the-boundary-canon-owns-discerns-noes.md) and the claims ledger's evidence classes in [ADR 0270](0270-the-benefit-canon-separates-value-from-claim-qualification.md).

## Context

The claims ledger graded every public claim by evidence class and fixed its strongest wording, conditions, and forbidden inference. Its `primarySource` was prose: "feature registry/canon; config schema; glossary." No reader could open that, and no test could check it. The Boundary Canon carried a typed decision/guard/source record per boundary, but its guard held only that each path existed, and eleven boundaries named no guard at all, four of them while publishing a refusal.

The suite already held most of the mechanisms. Standards that cannot loosen, the no-network shipped graph, landing authority, exact-tree Proof: each had a test that fails when it regresses. The registries did not know, so a writing agent that could not find the proof in one lookup hedged, and an audit could not tell an enforced promise from a described one.

A ledger that names a test the test never agreed to hold would be a new kind of drift. The binding has to run both ways.

## Decision

**Every public claim and every product boundary names an inspectable basis, and every guard in that basis cites the row it holds.**

- `Claim` carries `basis`, the same `EvidenceSource` record the Boundary Canon uses, shared through the brand model. The ledger renders it under each claim as **Inspectable basis**.
- A claim whose evidence class includes `structural`, and a boundary that publishes a refusal, must name at least one `guard`. A guard is a top-level test module.
- A guard module's module-level doc comment carries one `Guards:` line citing `claim:<slug>` or `boundary:<id>`. `tests/evidence_basis_guard_test.ts` sweeps both directions: every guard row finds its citation, and every citation finds a live row that lists the module. The citation is authored, never generated, because it is the test author's statement that the module exercises the claim.
- The absolute do-not-claim list is enforced: `tests/do_not_claim_guard_test.ts` refuses any of its sentences on a public surface, matching each sentence exactly so a negation or rewording passes.
- Four refusals gained guards at their narrowest chokepoint: recoverable destruction through the drop test's recovery refs, the credential boundary through the shipped graph's environment reads, the config schema's keys, and credential-store paths, the non-gamified practice through the Patterns result schema's keys, and Proof scope through the Proof renderer's vocabulary. The provider security boundary now names the test that holds the shipped seed to hooks alone.
- "discern runs on itself" becomes structural through a test that reads this repository's own configuration and hosted gate lane.

## Consequences

- A structural claim is a claim the Gate defends. Copy can state it without a hedge, and a reader can run the guard the ledger names.
- Adding a claim or a refusal now costs a guard, or an honest evidence class below structural. That is the intended price.
- A test cited as a guard cannot be deleted or renamed without the registry noticing, and a registry row cannot point at a test that never enrolled.
- The agent-facing brand voice skill now separates a demand entry's evidence class from the class of the product fact that answers it, so a `hypothesis` label on a struggle no longer spreads to a `structural` claim beside it.
- Per-file citation is the granularity. A module that holds several rows cites them all on one line; a finer, per-test binding is available later without changing the registry shape.

## Alternatives considered

- **Generate the `Guards:` lines from the registry.** Rejected: the citation is the author's attestation, and a generated one attests nothing.
- **Keep prose sources and trust review.** Rejected: that is the state that produced hedging agents and an audit finding.
- **A repository-wide lexical scan for every claim.** Rejected, as in ADR 0305: most claims have an authoritative chokepoint and deserve a guard there; a broad scan would look like proof without covering paraphrase. The do-not-claim scan is the one exception, and it matches whole sentences only.
- **Require a guard for every boundary, not only those with refusals.** Deferred: identities and absences are category and structure statements whose evidence is often a decision; forcing a guard would invite fixture-shaped tests.
