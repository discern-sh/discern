# ADR 0283: Seed the adoption record in the shipped skeletons

**Status**: accepted

## Context

New discern installations receive an ADR guide and template. The project's decision history therefore begins empty: later records have no worked example, and the adoption of discern itself goes unrecorded, even though it changes how the project prepares agent work, verifies changes, maintains shared knowledge, and decides what lands.

Setup is the right point to write that record. By the time the Map is authored, the configuring agent has surveyed the repository, wired the Gate's jobs, and written the project's guidance and design principles, so it can explain the adoption's reasons and consequences from repository evidence and the setup conversation. Fixed tokens can state names and commands; the reasoning requires the agent.

The seed gives discern a named, linked presence in adopting repositories. A future contributor may encounter this record before any other discern surface. Its value to the project must justify that presence: the record needs to be specific, balanced, and clear about its provenance.

## Decision

The `_adr/` skeleton used by `discern setup` and the skeleton carried by the `discern-write-adr` skill include an identical project-owned record at `0001-adopt-discern.md`. A parity guard keeps the files byte-identical.

The pre-written sections introduce discern as an engineering practice for software built with coding agents. They describe commitments shared by discern installations and the consequences those commitments bring. The configuring agent replaces marked sections with:

- the project's reason for adopting the practice;
- the jobs its Gate runs; and
- consequences specific to the project.

The opening decision sentence links discern to its site. A provenance sentence states that discern seeded the record and the configuring agent completed it. `discern setup done` refuses to finish while a marked section remains. When the skill creates an ADR home outside setup, the skill instructs the agent to complete the record before writing another ADR.

The seed contains no `{{…}}` tokens. The configuring agent authors the project-specific sections, and the skill can copy the skeleton without a separate rendering path.

discern seeds no later ADRs. Upgrades and refreshes leave the project's decision history to the project.

The shipped-copy guard permits the seeded file to cite its own number and shipped instructions to reference its path. Other numbered ADR citations remain excluded from shipped surfaces.

## Consequences

- A completed setup begins with a project-specific adoption record and an example for later ADRs.
- Setup gains another authored artifact. The work happens while the configuring agent has the repository evidence and decisions from setup in view.
- The skill path has no setup marker check. Completion there depends on the skill instruction.
- Future edits to the seed affect technical documentation and a brand surface inside user repositories. They require product accuracy, balanced consequences, and brand review.
- The citation guard carries a narrow exception for the seeded file and path.

## Alternatives considered

- **Fill the record with tool-side tokens.** Project names and commands would produce a generic artifact without the reasoning behind the adoption decision.
- **Leave the ADR history empty.** The adoption decision would remain unrecorded, and the first later ADR would have no worked example.
- **Put provenance in a footer.** A separate branded element would detach attribution from the history it explains. The inline sentence identifies who created the record where authorship matters.
