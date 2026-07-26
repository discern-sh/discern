# ADR 0190: Cohort findings lift the provider-comparison deferral, under standing conditions

**Status**: accepted; amends the provider-comparison deferral in [ADR 0160](0160-local-logbook-advisory-readers.md), builds on [ADR 0166](0166-agent-identity-is-advisory-logbook-evidence.md) (whose evidence boundary and permanent rejection of identity-driven behavior stand unchanged)

## Context

ADR 0160's explicit *no*s deferred agent-vendor attribution: "comparing providers is a reader that can accrete later if a cheap, honest hint exists." ADR 0166 then let the logbook record source-labelled identity evidence without a verdict, and the reader groundwork learned to score it: `driverAgent` names an identity only when an event's invocation-scoped evidence agrees on exactly one agent, the `patterns` report states how much of the corpus is attributable, and the identity-gap and provider-fit detectors read the evidence without comparing anyone.

Days into identity recording, the deferral's own condition was met. The hint exists and is honest — on the corpora observable at the time of this record (six discern-run repositories on the maintainer's machine, described here by shape because most are private), attribution rates ran high and every corpus shape a comparative layer must handle was live: a balanced two-cohort corpus, a lopsided-but-real one, a near-single-cohort one with a trace second, pure single-cohort ones, and human-majority ones. What was still missing was the comparative layer itself: every behaviour finding pooled all agents into one population, so an owner could see _that_ the practice thrashes but not _which_ driver population is thrashing, and a guidance gap could not say _whose_ compiled guidance failed to land — despite discern being the tool that compiles one authored source into every provider's guidance file, which makes per-provider gaps uniquely its loop to close.

The risk that justified the deferral has not gone away: a "comparison" built on a handful of runs, an ambient host marker, or a rendered ranking would poison trust in the whole advisory surface. Lifting the deferral therefore has to carry its guardrails with it.

## Decision

**The `patterns` reader may segment findings into per-agent cohorts. The lifting is conditional, and the conditions are standing — they bind every cohort reading, now and later:**

- **Facts beside denominators, never rankings.** A cohort finding renders per-cohort counts with their denominators, in its `observed` sentence as much as its `evidence` — no ranking, no score, no cross-cohort ratio pronounced as a verdict (ADR 0063). Task-difficulty confounds are real; the owner draws the comparison, the verb only lays the counts side by side.
- **Cohort keys come from invocation-scoped evidence only.** One seam (`cohorts.ts`) derives every cohort key through `driverAgent`, which reads the catalogue's lifetime record — so ambient host state never mints a cohort, a future ambient source class is excluded automatically, `custom` is a single cohort never subdivided, and a unit two agents drove belongs to neither.
- **Recorded minimums gate every split.** A cohort speaks only past an absolute per-cohort run floor and a share floor, both recorded in one place (`COHORT_MINIMUMS`) and tuned against the observed fleet shapes: the balanced corpus must speak, the trace-second corpus must stay silent (its trace clears any honest absolute floor, so the share floor is the load-bearing one). Below the minimums a cohort detector reports insufficient evidence — a corpus that cannot honestly compare gets no one-sided "comparison".
- **The unattributed share is always visible**, even at zero, and below-minimum cohorts are stated beside the comparison rather than silently dropped.
- **Guidance parity names the surface, not the agent.** A gap one population keeps hitting while its peers never do points at that provider's compiled guidance surface (named from the shared catalogue), and a gap every cohort hits stays un-split — a shared gap is a shared fix.
- **Driver releases join the boundary vocabulary.** The dominant MCP client's recorded version changes bound trend windows exactly as config epochs and discern releases do, attributed with the client, the version pair, and the date. Only the dominant client's boundaries count, and a version-blind corpus — a cohort attributed entirely through process evidence — simply has none: an absence, never an error and never grounds to void the cohort.

The explicit *no*s hold. No identity finding may automate anything — proposals only, per ADR 0166's permanent rejection. No new logbook fields: the substrate already carries everything this layer reads. Export, session replay, and guidance-amendment drafting remain deferred by ADR 0160.

## Consequences

- **The owner's question finally has an answer surface**: which agent populations drive the project, how each fares, and whose compiled guidance isn't landing — stated so plainly the counts speak for themselves.
- **Trend windows fragment at client upgrades.** The fleet showed dominant clients crossing several versions in days, so comparable tails shorten and some trend detectors will report attribution instead of trends more often. That is the honest trade: a shift landing exactly at an upgrade must not be blamed on the setup.
- **The minimums are launch-crunch numbers.** The corpora they were tuned on recorded an atypical burst; recording them as tunable values in one seam is the mitigation, not a claim they are final.
- **A rendering discipline, not a rendering guard.** "No rankings" binds sentence shape, which no cheap structural test can hold; the parameterized cohort guards hold what is mechanical (denominators present, unattributed share stated, ambient evidence powerless, minimums enforced), and review holds the prose.

## Alternatives considered

- **Keep the deferral.** Rejected: its stated lifting condition — a cheap, honest hint — is met, and every corpus shape the layer must handle is live now to tune against; waiting buys no better evidence, only a colder start.
- **Rank or score cohorts for readability.** Rejected permanently on ADR 0063's grounds: a league table converts confounded counts into a vendor verdict the evidence cannot support, and one such sentence would cost the advisory surface its trust.
- **A general boundary engine over every client's versions.** Rejected: n-dimensional windows would shred comparable history for marginal attribution gain; the dominant client's boundaries capture the shift that actually moves a corpus's behaviour.
