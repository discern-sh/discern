# ADR 0304: A tenth bundled skill sets the checkpoint

**Status**: accepted; the third owner-approved growth of the set [ADR 0173](0173-trim-the-bundled-skills-to-seven.md) capped, following the enrolment pattern of [ADR 0263](0263-a-ninth-bundled-skill-await-the-fleet.md). Serves the checkpoint contract of [ADR 0293](0293-checkpoint-declarations-interlock-the-gate.md), the shared criterion vocabulary of [ADR 0295](0295-one-criterion-vocabulary-serves-two-memberships.md), and the shipped set of [ADR 0303](0303-the-shipped-checkpoint-set.md).

## Context

The checkpoint feature teaches its _operating_ moments thoroughly: the `awaiting_declaration` refusal serves the criterion with both recoveries, `prepare`/`status` preview coming declarations, the tool descriptions carry the `met`/`unmet` and variance mechanics, and the operating-policy registry holds the declare conduct on the always-loaded surfaces. Nothing teaches the _authoring_ moment. "Make agents check migrations before landing", "flag risky changes to the payment paths", "agents keep merging huge deletions without review" are asks that arrive before any verb runs, so no refusal or hint can reach them — and answering one well takes judgment the config reference cannot carry: whether the rule belongs at this rung of the placement ladder at all, whether its violations arrive with a diff or accrue, how to keep a `stop` rare enough to stay meaningful, and how to write a criterion with a real unmet answer.

[ADR 0173](0173-trim-the-bundled-skills-to-seven.md) fixed the bar for bundling: a skill must teach what a frontier model would not do unprompted, and skills answer asks while hints answer verb moments. [ADR 0263](0263-a-ninth-bundled-skill-await-the-fleet.md) established the enrolment ceremony a new member follows.

## Decision

**`discern-set-a-checkpoint` ships as the tenth bundled skill: the authoring judgment around `[checkpoints.<id>]`, from placement to later economics review.**

The body walks seven steps: the placement ladder (does the rule belong here at all), the scarcity bar and the mode choice, the deterministic trigger menu, criterion writing (a question the agent can judge, in second person, with a real unmet answer and no secrets), wiring and the trunk-governs consequence (the entry governs new efforts once it lands; a branch edit does not govern its own gate), the `when` escape hatch with its v1 execution boundary, and the later economics review through `discern checkpoints` and `discern patterns` — ending at the graduation move: a criterion that becomes mechanically decidable leaves through the `discern-set-the-standard` outlaw procedure.

The ladder is quoted **verbatim** from its single source (`placementLadderProse()` in `src/shared/criteria.ts`), and a parity test (`tests/skills_test.ts`) enrols the skill as a rendering surface, so a reworded rung updates the criterion teaches and the skill together or fails the gate. The skill carries a surface-contract row (`scripts/agent_surface_contracts.ts`) whose stop condition pins the authority boundary in the body's own words: a variance is never the agent's to authorize.

The name follows the set's imperative verb-phrase convention and pairs with `discern-set-the-standard`: the two skills split one decision — a rule a machine can decide gets a standard; a rule that needs judgment gets a checkpoint — and each body routes to the other at the crossover. The description carries the routing vocabulary ("make agents check X", "flag risky changes to Y", a reviewer's recurring non-mechanical point, tuning a noisy or frequently-varied entry).

Enrolment on addition, per the closed-set guards: a feature-canon node (`skill-set-a-checkpoint`) with its plain rendering, a desk tip, a `taught` claim under the practice canon's _the project remembers_ tenet (a checkpoint is another home a routed lesson can land in), rows in both bundled-skill catalogs, and the routing row in `discern-teach-the-project`.

The owner raised the standards on `main` before the programme: `skills_count` to 10 and `skills_words` to 1040. The skill adds 127 frontmatter words, bringing the measured corpus to 1019; pinning the ceilings back down to the measured values is deferred to the owner on the trunk.

## Consequences

- The authoring ask routes to a procedure instead of improvised config edits: placement is decided before syntax, and the scarcity bar is applied where the entry is born rather than discovered through noise later.
- Every agent session in every installed project pays 127 additional ambient frontmatter words; `[skills].exclude` remains the opt-out.
- The ladder now renders on three guarded surfaces — the criterion teaches, the estate review, and this skill — with one authority behind all of them.
- The catalog and canon guards enrolled the tenth member on addition, so a rename or removal strands its claims and fails the gate, as designed.

## Alternatives considered

- **Fold the procedure into `discern-set-the-standard`.** Rejected: the skills split one decision at a clean seam — measurement versus judgment — and folding them would bury the checkpoint's distinct contract (declarations, variance, trunk policy) inside a metric procedure most readers open for numbers.
- **A hint on the checkpoints verb or refusal.** Rejected on the established line: hints answer verb moments, and the authoring ask precedes any verb.
- **The map narrative alone.** Rejected: the narrative teaches the contract, and map pages are found by readers already inside discern's documentation; skill descriptions are the surface indexed by conversational intent.
- **Extend `discern-teach-the-project` instead of shipping a dedicated skill.** Rejected: teach-the-project owns routing a lesson to its home; the checkpoint home needs its own authoring judgment once routed there, exactly as docs route to `discern-document-subsystem`.
