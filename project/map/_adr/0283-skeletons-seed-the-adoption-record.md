# ADR 0283: The shipped skeletons seed the adoption record

**Status**: accepted

## Context

The `_adr/` skeleton shipped a format guide and a copy-paste template, and nothing else. Every adopting project's decision corpus therefore cold-started at zero: the convention arrived with no instance, the first real record was written unguided by whatever future session happened to need one, and the adoption of discern itself — a hard-to-reverse choice a future contributor will absolutely wonder about — went unrecorded. A template teaches a record's form; only an instance teaches its register: length, tone, how much context, what honest consequences look like. Agents pattern-match on instances.

A seed stamped in by the tool alone would not close the gap: a record that could describe any project records nothing about this one. discern is positioned to do better, because its setup model already makes the coding agent the configuration engine: by the time the map is authored, the agent has surveyed the repository, wired the gate's jobs, and written the design principles. It holds everything a true adoption record needs.

There was also a commercial wish: the record is a legitimate, tasteful place for discern's name to live in adopting repositories. That wish is in tension with the exemplar role — the format guide's own rule says a record listing only upsides is not trustworthy, and the first record is the one every later record imitates.

## Decision

Both shipped `_adr/` skeletons — `discern setup`'s and the `discern-write-adr` skill's, already held byte-identical by the gate — seed `0001-adopt-discern.md`: a mostly-written record of adopting discern, completed by the configuring agent. The pre-written prose states the discipline (done means the gate, isolated worktrees, recorded decisions) and honest generic consequences, costs first. `setup fills this` markers hold the three slots only the agent can fill truthfully: this project's context, what the gate actually runs, and project-specific consequences. Setup's Step 6 and the skill's lay-the-home step instruct the completion; the existing marker walk refuses `setup done` while the record is unfilled.

The brand payload is the record's substance, not an advert: one link, in context, where the practice is named — plus a provenance sentence stating the record was seeded and then completed by the configuring agent. The provenance disclosure is the marketing; nothing else is.

The explicit *no*s:

- **No tool-side template substitution.** The stub carries no `{{…}}` tokens; substitution would produce a form letter and would break the skill path, which copies the skeleton verbatim. The agent is the instantiation mechanism.
- **No derived completion predicate.** The record stays in Step 6's marker-gated, self-verified family; the brief carries the quality bar.
- **No further tool-authored records.** `0001` is the only ADR discern ever seeds. Upgrades and refreshes never author decisions; a corpus of tool-written entries would corrupt the register the seed exists to start.
- **The citation guard bends by exactly one number.** The seeded record may cite its own number in its own file, and its path joins `0000-template` as a legal numbered `_adr/` path in shipped text. Foreign numbers in the seeded record, and every other numbered reference in shipped surfaces, still fail.

## Consequences

- Every adopting project's corpus starts with one true, project-specific record — the exemplar in place before the first ordinary record is written, and the answer to "who decided this project works this way, and why" on the record from day one.
- The record must be completed honestly to pass setup, so the cost of the feature falls on the configuring agent's session, where the knowledge already is. In the skill's post-hoc path no marker gate exists; the skill's instruction is the only enforcement there.
- The shipped surface now carries a sanctioned numbered citation, held to its narrow shape by positive controls; loosening it further is a guard edit with this record to answer to.
- The seeded prose is brand-adjacent copy inside user repositories. Its trustworthiness now depends on the honest-costs framing surviving future edits — a promotional rewrite would violate the format guide sitting beside it and cheapen every record patterned on it.

## Alternatives considered

- **Tool-side template replacement** (project name, stack, dates stamped by the binary). Rejected: it yields a generic artifact that records no real reasoning, and the setup architecture already provides a better instantiation mechanism — the agent in the loop.
- **Not seeding; teaching by README alone.** Rejected: that was the status quo, and it leaves the adoption unrecorded, the corpus empty, and the first record's register to chance.
- **A provenance footer outside the record's body.** Rejected by the owner: a footer reads as an afterthought or a smuggled namedrop; woven into the decision's own prose, the same sentence carries substance.
