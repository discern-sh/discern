# ADR 0179: The feature canon carries an agent-experience axis

**Status**: accepted; extends the feature registry ([ADR 0175](0175-the-feature-canon-compiles-from-a-feature-registry.md)) and reads the hint registry's audience contract ([ADR 0172](0172-hints-compile-from-a-registry.md)).

## Context

discern is installed by humans but operated by coding agents: the human runs setup and reviews receipts, and nearly every other surface — the verbs, the MCP tools, the hints, the compiled guidance — is read by an agent. The product reflects this in mechanism after mechanism that exists purely as agent-facing interaction design: the write preflight that proves authority before slow work because sandboxes lie about permissions ([ADR 0152](0152-slow-workflows-prove-write-authority-first.md)), the document discovery funnel budgeted for context windows ([ADR 0174](0174-agent-document-discovery-funnel.md)), hints fired deterministically at the moment they apply, verbs that are idempotent so an agent calls them instead of pre-checking.

The feature canon carries none of this as itself. A node states `what` (the mechanism) and `why` (the benefit) — and every `why` is written from the owner's chair. The registered-hints node reads as governance ("whether advice gets followed is measurable") when the agent-side truth is that the right next step arrives inside a tool result at the exact moment it applies. The deepest agent-facing mechanisms — the preflight, the funnel — have no node at all. Launch work now needs the agent-side story as first-class material: creative pieces addressed to the agent audience, and an account of the interaction design humans never see. Re-deriving that story by hand is the exact failure mode ADR 0175 exists to close.

The product itself already distinguishes these audiences: a hint's `audience` field marks entries whose instruction only an agent can execute, suppressing them from interactive human rendering while every envelope still carries them.

## Decision

**The feature canon stays one tree, and a node gains an optional second reading: `agent`, the agent-experience account — with `hints`, soft references into the hint registry.**

### The `agent` field

`agent` states how the feature reaches the agent as interaction design: what the agent sees, when it sees it, and what it never has to think about as a result. It is present only where that account is distinct from the owner's reading in `why`; the two coexist on one node. Adapting an existing feature means adding its agent account beside the human one — never replacing it, never duplicating the node. Mechanisms that exist primarily for agents enter as ordinary new leaves under their natural parents, at the resolution the tree already uses.

### Soft hint references

`hints` lists registered hint ids the node's account leans on. The enrolment guard fails a citation of an id the hint registry does not carry — and that is all. The hint corpus is deliberately **not** an enrolment set: no hint demands a citation, and no completeness check runs. This departs from the house full-enrolment discipline ([ADR 0051](0051-canonical-set-parity.md)) on purpose. The hint corpus is an order of magnitude larger than any enrolled set, most entries are operational detail beneath the canon's resolution, and a citation is an evidence pointer ("this account is implemented by that hint"), not a coverage contract. Guards extend symmetrically elsewhere: agent accounts obey the same sentence-completeness and live-verb command-mention checks as `what` and `why`, and a citation may only ride an account.

### Rendering

The account renders inline in the one canon page, marked `**Agent:**` beside the node's other statements, with cited hint ids alongside. The header stat line counts the accounts, and an agent's-eye index after the pillar list names every carrier, so mining the agent layer starts from one section. There is no second generated page: a projection helper (`agentExperienceNodes`) exports from the registry for any downstream tooling that wants the agent layer alone.

## Consequences

- The canon can speak about the agent's experience wherever a feature has one, and creative work addressed to agents filters one axis instead of re-deriving a feature list.
- Authoring cost rises where audiences diverge: such features now maintain two statements. Accepted — the divergence is real, and collapsing it is how the owner's chair came to narrate everything.
- Only existence of cited hints is checked; a hint's template can drift from the account that cites it without failing the gate. Accepted for an internal page: the citation names where to look, and the hint registry's own guards keep the hint itself true.
- The page grows a third statement register. The at-a-glance and pillar cuts are unchanged, so readers who want the old resolution still get it.

## Alternatives considered

- **A dedicated "agent experience" pillar.** Rejected: the agent layer is a lens across the product, not a product area. Nearly every candidate member already has a natural parent, and a pillar would fork the tree by audience — the same feature claimed twice at two resolutions.
- **A second generated projection page.** Rejected: it splits the single reading surface ADR 0175 established, and a projection is derivable from the exported helper the moment a consumer actually needs one.
- **Enrol the hint corpus as a seventh closed set.** Rejected as noise: hundreds of claims restating the hint inventory page, with the marginal truth already delivered by existence-checked citations.
- **An `audience` enum on feature nodes instead of prose.** Rejected: most features serve both audiences, and the value is the account itself — a tag records that a difference exists while discarding what it is.
