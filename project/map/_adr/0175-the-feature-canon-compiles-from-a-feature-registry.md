# ADR 0175: The feature canon compiles from a feature registry

**Status**: accepted

## Context

The launch programme keeps needing one answer to a simple-sounding question: what, exactly, does discern offer? The landing page ([ADR 0156](0156-permanent-landing-page-and-install-endpoint.md)), the strategy and marketing notes under `_private/maintainer/`, the manual's section overviews, and the glossary canon ([ADR 0169](0169-the-launch-glossary-canon.md)) each carry a partial account, re-derived by hand every time. The marketing scratch documents demonstrate the failure mode: each one re-lists the product's capabilities from memory, at a different resolution, with a different subset missing. Nothing in the repository can enumerate the feature set, count it, or prove a new capability was accounted for.

The registry discipline that fixes this class is proven twice over. The glossary compiles from a term registry with drift and enrolment guards ([ADR 0164](0164-glossary-compiles-from-a-term-registry.md), [ADR 0167](0167-term-registry-polices-the-vocabulary.md)); hints compile from a typed hint registry with a generated inventory ([ADR 0172](0172-hints-compile-from-a-registry.md)). Both follow the forcing-function rule for canonical sets ([ADR 0051](0051-canonical-set-parity.md)): a single source, generated artifacts, and guards that make live usage follow the source mechanically.

Features are not terms, though. A term names one concept once; a feature decomposes — the standards subsystem is one pillar, a dozen mid-level capabilities, and several dozen fine-grained behaviors, and different consumers need different depths (a tagline wants the pillar, a comparison table wants the leaf). A feature also carries two statements where a term carries one: what the mechanism does, and what it buys the user — the benefit, which creative and marketing work needs as first-class material, and which can exist at levels of abstraction no single mechanism owns. And the feature surface is coupled to more closed sets than the vocabulary is: the verbs, the known jobs, the config tables, the bundled skills, and the agent providers all grow independently, and each addition is a product change the feature account should not be able to miss.

## Decision

**The product's features and benefits are one registry — a tree in `scripts/feature_registry.ts` — and the canon page generates from it, with enrolment guards holding every closed-set member to a claim.**

### The registry

A feature node carries a stable kebab-case `id`, a display `title`, a one-or-two-sentence `what` (the mechanism, technical register), an optional `why` (the benefit, in the abstract), optional `children` at the next resolution, and optional `surfaces` — explicit claims on closed-set members, written `set:member` (`verb:done`, `job:test`, `stage:fix`, `config:standards`, `skill:discern-cure-a-bug`, `agent:codex`). Nodes whose statement is value rather than mechanism mark themselves `kind: "benefit"`; a benefit is a first-class node, not an annotation. Top-level nodes are the pillars, and every pillar states its `why`. Depth is resolution: cutting the tree at depth one yields the pillar summary, the leaves yield the exhaustive inventory, and every cut in between is a legitimate reading.

The registry lives under `scripts/`, beside the term registry, for the same reason: its strings are map prose, the sanctioned home for internal decision citations, and it is measurement-and-authoring tooling for this repository — no part of the shipped binary.

### The generated page

`deno task codegen` renders the canon to `_private/maintainer/feature-canon.md`: an at-a-glance pillar list, the full tree, and a generated coverage appendix mapping every closed-set member to the node that claims it. A sync test fails the gate when the page drifts from the registry.

The `_private/maintainer/` tier is a decision, not a default. The page is a working database for the maintainer and for agents doing product, creative, and marketing work — the same audience as the strategy corpus it sits beside and feeds. The manual remains the reader-facing account of the product; publishing a second, compressed enumeration would give readers two overlapping feature stories to reconcile. Placement outside the published projection also keeps a maintainer database from consuming the reader-calibrated prose budgets (the Vale pass and the public-corpus standards), which exist to protect readers, not inventories.

### The guards

- **Enrolment.** Every member of the six closed sets — top-level verbs, known jobs, stages, top-level config tables, bundled skills, agent providers — must be claimed by at least one node's `surfaces` or recorded in a deliberate-absence table with its reason. Exactly one of the two: an unclaimed, unrecorded member fails the gate until someone decides where it belongs, and an absence record for a member the canon now claims fails as stale. The sets are read from their single sources (`KNOWN_VERBS`, `KNOWN_JOBS`, `STAGES`, the config schema's shape, the bundled-skills directory, the agent catalogue), so a new member auto-enrols in the check itself.
- **Claim validity.** Every `surfaces` key must name a live member of a known set. A rename or removal strands the claim and fails the gate — the canon cannot describe a product that no longer exists.
- **Structural integrity.** Ids are unique and kebab-case across the whole tree; every node states a complete `what`; every pillar carries a `why` and children.
- **Command references.** Every `discern <verb>` mention in canon prose is validated against the live verb registry — the same move the hint corpus and the map's fenced examples make — so a verb rename fails the canon mechanically.

Claims are explicit keys rather than inferred from prose, diverging from the glossary's naming predicate on purpose: a single node routinely covers many members (the staged pipeline claims four stages; the installer pillar claims five verbs), and prose inference at that fan-out is guesswork. Explicit keys let code enumerate and check coverage, which is the point of a database.

### What this deliberately does not do

The MCP tools are not a seventh enrolment set: the verb-parity guards already bind every tool to its verb, so enrolling both would double-claim each capability — the canon claims the verb and describes the MCP surface as a feature in its own right. There is no public page, no new verb, and no shipped surface — the registry is repo-internal, like the term registry. There are no alternative-name or tagline fields: ADR 0169 owns naming, one name per concept, and creative variation belongs in the pieces that cite the canon, not in it. The canon is the source marketing copy quotes; it does not generate the copy.

## Consequences

- A new verb, known job, config table, bundled skill, or agent provider fails the gate until the feature canon accounts for it. The product inventory can no longer lag the product — which is the contract, and its cost: every new member is two touches (the thing, plus its canon claim), the same deliberate price the hint registry pays.
- Creative, technical, and marketing work reads one enumerable source at whatever resolution the piece needs, and the coverage appendix replaces hand-audits of "did we mention everything?".
- A skill rename or removal strands its claim and fails the gate, forcing the canon to follow in the same change — the bundled-skills trim ([ADR 0173](0173-trim-the-bundled-skills-to-seven.md)), which landed while this canon was being authored, is the live demonstration: five cuts and two renames, each of which would have stranded a claim.
- Promoting canon material to a public surface is a separate editorial act; the canon supplies facts, and the voice pass supplies register.
- The registry is large by design: it is the one place to read the entire product.
- Compressed restatements of behavior the manual already documents now exist in a second place. Accepted: the two serve different jobs (database versus documentation), the canon cites no reader-facing obligation, and the guards hold the canon to the code rather than to the manual.

## Alternatives considered

- **Extend the term registry to hold features.** Rejected for the reason ADR 0172 rejected it for hints: terms are display vocabulary with matching rules; features are hierarchical capability data with benefit framing and multi-set claims. One registry serving both would strain both schemas.
- **A hand-written features document under `_private/maintainer/`.** Rejected: that is the status quo in all but name, and the marketing scratch documents already show it drifting. A list nothing enforces is a list that is wrong.
- **A flat list with a category field.** Rejected: resolution is the requirement. A tree's nesting is the zoom; flattening it forces every consumer back to one depth.
- **Infer claims from prose mentions, as the glossary enrolment guard does.** Rejected: workable at one-term-one-concept fan-out, guesswork at one-node-many-members fan-out. Explicit keys can be checked and enumerated by code.
- **Publish the canon (`_internal/` or `70-reference/`).** Rejected: readers already have the manual as the product account, and a maintainer inventory held to reader-facing prose standards serves neither audience well. Revisit if a public "features at a glance" page is ever wanted — as an editorial projection of the canon, not a relocation of it.
