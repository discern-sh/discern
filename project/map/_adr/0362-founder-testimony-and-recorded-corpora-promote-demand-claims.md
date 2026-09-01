# ADR 0362: Founder testimony and recorded corpora promote demand claims

**Status**: accepted. Extends the market evidence classes of [ADR 0292](0292-the-demand-canon-counters-the-benefit-canon.md).

## Context

ADR 0292 seeded the demand canon before launch and classified every struggling moment as a hypothesis. It allowed three market evidence classes: observational for internal evidence, including founder use; anecdotal for a named external person's permitted account; and hypothesis for an untested interpretation.

The first evidence sweep found patterns those classes could not describe. Several struggling moments were present in the founder's own experience and in concrete public accounts across GitHub, Reddit, independent blogs, and a vendor engineering report. That corpus is stronger than an untested hypothesis, but it is neither internal observation nor a named testimonial discern holds permission for. Leaving the entries as hypotheses would tell a future writer that no external test had occurred, and every brand draft would carry a hypothesis label the evidence no longer warranted.

Public discussion is also not a representative sample. Repetition across a few forums cannot establish how common a problem is, which segment feels it most, whether it causes an outcome, or whether anyone will buy a solution. The evidence system has to recognize qualitative corroboration without laundering it into research-grade validation, and without burying each claim under restated limits: a record that stacks the class rule, per-row limits, a counterexamples list, a product-boundary paragraph, and a do-not-claim list on every claim, and prints the same corpus on every entry it reaches, reads as terms and conditions rather than evidence.

## Decision

**A recorded public corpus promotes a demand entry to a new `corroborated` class, a founder account alone promotes it to `observational`, and each limit is written at one layer.**

- The claims ledger gains `corroborated`: a tightly scoped qualitative market pattern found independently in a recorded public corpus. It permits non-quantified, segment-scoped recognition language. It cannot support prevalence, causation, typical outcomes, endorsement, product effectiveness, or a quotation presented as a testimonial.
- A corpus is a named record in `DEMAND_CORPORA` (`scripts/brand/demand.ts`): the bounded pattern, at least three distinct public accounts across at least two venues, each with its venue, title, and canonical HTTPS location, and one sentence of limits. A corroborated evidence row cites its corpus by id; the demand canon page renders each corpus once and links every entry to it, so a corpus reused across entries reads as one observation. The guard holds the minimum and rejects a corpus no entry cites; editorial judgment still decides whether the accounts describe the same bounded pattern and are independent enough to count.
- A sweep has two rungs, each progress on its own. The founder's account, recorded in his own words in the launch narrative's founder scenes, promotes the entries it reaches to `observational`: attributed, dated, told as discern's own experience. A recorded corpus promotes them to `corroborated`. Repository history may confirm or correct the chronology of an account; it does not substitute for the corpus, and the sweep record needs no commit-level forensics.
- Limits live in two places only: the ledger's class table says what each class supports, and each corpus carries the limits of its accounts. The private sweep record holds only what is specific to a story: where the record confirms or corrects memory, and the public line the story earns.
- Founder scenes are first-person memory, and public copy may tell them that way. A number appears only when the sweep records a measurement behind it. Named or quoted external experience remains anecdotal and permission-bound.

## Consequences

- A writing agent can state a corroborated situation directly, with no hypothesis label, while numbers, universals, customer outcomes, and product-efficacy claims still need their own evidence.
- A session that records a founder story has changed an entry's evidence class before any research starts.
- The demand canon page costs one section per corpus rather than one paragraph per entry.
- The corpus is directional pre-launch evidence. Interviews remain the route to incidence, intensity, language, alternatives, buying triggers, and willingness to pay.
- A future market evidence class enrolls through the shared ledger and the demand-canon parity guard.

## Alternatives considered

- **Keep the entries as hypotheses until formal interviews.** Rejected: it records falsely that no external test occurred and recreates the drafting deadlock the evidence system exists to resolve.
- **Classify the corpus as anecdotal, or the founder account as observational and stop there.** Rejected: anecdotal governs a named person's attributable result and permission, and observational alone would discard the evidence that the pattern appears outside discern.
- **Call the class validated.** Rejected: qualitative public discussion does not validate prevalence, segmentation, or demand for the product.
- **Store each corpus inline on its evidence row and restate its limits per sweep.** Rejected: the same sources rendered on every entry read as more evidence than they are, and restated limits turn an evidence record into small print.
