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

The first `discern-write-it-once` draft named the doctrine clearly and included declared universes and comment currency, but its trigger reached every new project or feature and its absolutes invited speculative registries. A separate `discern-encode-the-invariant` draft added scope guards, boundary validation, observed outcomes, convergent reruns, and stronger proof, but its name was harder to discover and its body approached a general architecture manual. The final Skill needs the first draft's recall and the second draft's operational safeguards.

## Decision

**`discern-write-it-once` ships as the eighth bundled Skill.**

The Skill teaches one procedure for a shared fact or multi-effect decision:

- state the observable contract, checkable invariant, authority, effects, and proof;
- centralize only facts whose consumers express one decision and must change together;
- derive equal representations, generate mechanical copies with a currency check, use exhaustive handling for closed sets, and parity-check judgment-written consumers;
- make repo-wide rules consume a declared authored-source universe;
- compute one plan before mutation, then report that plan with observed outcomes;
- validate external input before effects and design successful and partial-state reruns to converge;
- comment only invariants, traps, and reasons that code and version history do not record;
- prove future-member enrollment, the public boundary, failures, and reruns.

Its description includes the conversational triggers "coding practices," "principles," "conventions," and "house rules," plus concrete drift and workflow triggers. It does not trigger on every project or feature. The body also refuses one-consumer registries and incidental similarity, keeping the write-once rule from becoming a command to abstract everything.

The deeper sibling playbooks retain their ownership. An observed defect routes to `discern-cure-a-bug`; a defended metric or legacy-pattern ban routes to `discern-set-the-standard`; accumulated duplication routes to `discern-clear-the-decks`; a significant authority decision can route to `discern-write-adr`.

The owner raised the standards on `main` before this implementation: `skills_count` from 7 to 8 and `skills_words` from 717 to 857. This change uses the count slot and adds 80 frontmatter words, bringing the measured total to 797. The same change lowers the ambient-word ceiling from 857 to 797.

## Consequences

- Installed projects gain an ask-shaped playbook for the structural practices discern's own guards enforce.
- Every agent session pays 80 additional frontmatter words. The description carries the recall vocabulary while staying materially shorter than the first draft.
- The scope guard makes a shared fate the test for centralization. Independent similarities remain independent.
- The procedure is longer than the original `discern-write-it-once` draft because it covers effects, boundaries, convergence, and proof. Each addition closes a failure mode already represented in discern's architecture.
- The Skill overlaps sibling playbooks at their entry points. Explicit routing avoids duplicating their deeper procedures.
- The feature registry, bundled-Skill catalogs, generated feature canon, and registry atlas enroll the eighth member. Existing parity guards make future rename or removal drift fail the gate.

## Alternatives considered

- **Ship the first `discern-write-it-once` draft unchanged.** Rejected: "starting a project or feature" is too broad for the ambient cost justified by [ADR 0173](0173-trim-the-bundled-skills-to-seven.md), "one source for every fact" encourages cargo-cult centralization, and the draft omits boundary and rerun behavior.
- **Ship `discern-encode-the-invariant`.** Rejected: the name hides the coding-practices trigger, while the longer procedure lacks declared universes and comment currency. Its scope guard, boundary handling, convergence, and proof become part of `discern-write-it-once`.
- **Put the discipline in built-in guidance.** Rejected: the procedure is ask-shaped and would consume every session's guidance budget.
- **Attach it to a hint.** Rejected: no discern verb marks the point where a shared fact first crosses consumers or effects.
- **Absorb it into an existing Skill.** Rejected: the seven existing Skills begin with a bug, a metric, accumulated clutter, a handoff, a documentation task, a durable lesson, or a decision record. This discipline applies while designing and implementing a cross-cutting change.
