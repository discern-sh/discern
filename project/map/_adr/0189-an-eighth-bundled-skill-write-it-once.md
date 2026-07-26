# ADR 0189: An eighth bundled skill teaches the write-once discipline

**Status**: accepted; the first owner-approved growth of the set [ADR 0173](0173-trim-the-bundled-skills-to-seven.md) capped.

## Context

[ADR 0173](0173-trim-the-bundled-skills-to-seven.md) reduced the bundled Skills to seven and fixed the bar for adding one: a bundled Skill must teach what a frontier model would not do unprompted, and Skills answer asks while hints answer verb moments. It also put ceilings on the count and ambient frontmatter words.

The owner asked for one more: a language-agnostic account of the coding practices this repository most strongly applies to itself. The codebase carries structural evidence that these practices need teaching:

- canonical sets bind their consumers through generated output, exhaustive handling, or parity checks that enroll future members ([ADR 0051](0051-canonical-set-parity.md), [ADR 0176](0176-the-closed-sets-are-a-closed-set.md), [ADR 0181](0181-an-ssot-claim-must-anchor-a-declared-canonical-set.md));
- generated artifacts are committed with currency checks, while curated copies are tied to their source by structural tests ([ADR 0026](0026-typed-config-schema.md));
- repo-wide sweeps read a declared authored-source universe instead of walking one convenient directory;
- effectful commands compute a plan before mutation and report the plan with observed outcomes ([ADR 0027](0027-plan-apply-engine-execution.md), [ADR 0028](0028-result-envelope-and-diagnostics.md));
- repeatable setup work reconciles toward an intended state ([ADR 0059](0059-worktree-setup-ensure.md));
- a gate guard keeps comments from restating code or recording obsolete history ([ADR 0053](0053-comment-currency-guard.md)).

These mechanisms exist because an instruction to "keep the copies in sync" does not make future changes enroll themselves. Installed projects cannot read this repository's map. Built-in guidance is reserved for operating discern in every session, and no verb result marks the conversational moment when a user asks for coding practices or when an agent encounters a cross-cutting fact. The delivery belongs in the Skill picker.

The first `discern-write-it-once` draft named the doctrine clearly and included declared universes and comment currency, but its trigger reached every new project or feature and its absolutes invited speculative registries. A separate `discern-encode-the-invariant` draft added scope guards, boundary validation, observed outcomes, convergent reruns, and stronger proof, but its name was harder to discover and its body approached a general architecture manual. Merging the two produced a version with the first draft's recall and the second draft's safeguards.

An owner review rejected that merged version's packaging. It answered a survey-shaped ask ("what practices should agent-written code follow?") with one monolithic procedure; it welded the fact-binding and effect-hygiene disciplines under a name that covers only the first; it never said where the practices came from, though the provenance is the reason to trust them; its triggers ("conventions," "house rules") also matched lookup asks about a project's _own_ conventions, where the right answer is that project's guidance; and its closing step reported findings only in conversation, where they evaporate. The owner also set the framing for the provenance: discern's codebase is a human/agent collaboration — a human supplies technical and creative direction, agents write the implementation — and the Skill should let a reader feel that arrangement is available to their project too.

## Decision

**`discern-write-it-once` ships as the eighth bundled Skill, shaped as a survey over two deep procedures.**

`SKILL.md` opens with the provenance — the human-directed, agent-written collaboration held to its own gate — and answers the practices ask directly with a catalog: one authority per fact, rules as checkable predicates, guards that enroll future members, declared universes for broad rules, planned effects with convergent reruns, and comment discipline, each compressed to the rule, the moment it bites, and the proof. A scope section refuses one-consumer registries and incidental similarity, keeping the write-once rule from becoming a command to abstract everything.

The two practices with real procedure weight live as files inside the Skill's directory, loaded when applied — the pattern [ADR 0173](0173-trim-the-bundled-skills-to-seven.md) set for merged Skills:

- `bind-the-fact.md` — elect the authority, bind each consumer down the derive/generate/exhaust/parity ladder, assert intentional subsets, and prove enrollment with a throwaway member;
- `plan-the-effects.md` — state the effect contract, validate at the boundary, compute one plan before mutation, apply narrowly, define convergent reruns, and prove it at the public boundary.

Applying the Skill leaves a durable record: a `canonical-sets.md` page in the project's configured map (created on first use, one row per fact — authority, consumers and bindings, the check that fails on drift), so the next session finds the authority by reading instead of forking a copy. The page is Skill-maintained convention only; engine awareness of it is deferred until field evidence shows the pages earning their keep, with this repository's own registry atlas and claim guard ([ADR 0176](0176-the-closed-sets-are-a-closed-set.md), [ADR 0181](0181-an-ssot-claim-must-anchor-a-declared-canonical-set.md)) as the internal precedent to build from.

The description triggers on adoption asks — what practices or principles agent-written code should follow — plus the concrete moments: a fact spanning code, config, docs, or tests; generated output drifting; a growing set outgrowing its handlers or coverage; an effectful workflow needing safe reruns. "Conventions" and "house rules" are dropped as triggers: they matched lookup asks the project's own guidance answers.

The deeper sibling playbooks retain their ownership. An observed defect routes to `discern-cure-a-bug`; a defended metric or legacy-pattern ban routes to `discern-set-the-standard`; accumulated duplication routes to `discern-clear-the-decks`; a significant authority decision routes to `discern-write-adr`.

The owner raised the standards on `main` before this implementation: `skills_count` from 7 to 8 and `skills_words` from 717 to 857. This change uses the count slot and adds 78 frontmatter words, bringing the measured total to 795. The same change lowers the ambient-word ceiling from 857 to 795.

## Consequences

- Installed projects gain an ask-shaped answer to "what practices should we adopt?" that carries its origin story, and two procedures for applying the load-bearing pair. An invocation that goes deep pays one extra file read, exactly as merged Skills already do.
- Every agent session pays 78 additional frontmatter words, and the ceiling pins that price.
- Applying the Skill accretes a per-project registry of authorities in the map. Whether those pages stay current is the same bet the map itself makes; if they prove valuable, engine support is a recorded follow-up, and if they rot, the loss is one page.
- The scope guard makes a shared fate the test for centralization. Independent similarities remain independent.
- The Skill overlaps sibling playbooks at their entry points. Explicit routing avoids duplicating their deeper procedures.
- The feature registry, bundled-Skill catalogs, generated feature canon, and registry atlas enroll the eighth member. Existing parity guards make future rename or removal drift fail the gate.

## Alternatives considered

- **Ship the first `discern-write-it-once` draft unchanged.** Rejected: "starting a project or feature" is too broad for the ambient cost justified by [ADR 0173](0173-trim-the-bundled-skills-to-seven.md), "one source for every fact" encourages cargo-cult centralization, and the draft omits boundary and rerun behavior.
- **Ship `discern-encode-the-invariant`.** Rejected: the name hides the coding-practices trigger, while the longer procedure lacks declared universes and comment currency. Its scope guard, boundary handling, convergence, and proof survive inside `plan-the-effects.md` and `bind-the-fact.md`.
- **Ship the merged monolith.** Rejected on owner review, for the packaging faults recorded in the context: a survey ask answered with a spec, two disciplines under one name, no provenance, lookup-ask triggers, and an output that evaporated.
- **Seed `canonical-sets.md` into every install, or teach the engine about it now.** Rejected: for most projects on day one that page is a registry with no consumers — the pattern the Skill itself refuses. It appears on first real use; engine awareness waits for evidence.
- **Put the discipline in built-in guidance.** Rejected: the procedure is ask-shaped and would consume every session's guidance budget.
- **Attach it to a hint.** Rejected: no discern verb marks the point where a shared fact first crosses consumers or effects.
- **Absorb it into an existing Skill.** Rejected: the seven existing Skills begin with a bug, a metric, accumulated clutter, a handoff, a documentation task, a durable lesson, or a decision record. This discipline applies while designing and implementing a cross-cutting change.
