# ADR 0353: Desk actions are registry facts reviewed before effects

**Status**: accepted. Extends the Desk decision authority from [ADR 0318](0318-the-desk-adapts-status-into-one-human-decision.md), its pure product boundary from [ADR 0352](0352-desk-decisions-cross-a-pure-responsive-presentation-boundary.md), and the plan/apply execution model from [ADR 0027](0027-plan-apply-engine-execution.md).

## Context

A supervisory action carries more than a label and callback. Its semantic group, current availability, factual refusal, recommendation, command evidence, consequence account, and confirmation policy must agree. If those facts live in separate menu switches, a new action can appear without a safe default, disappear when a dependency is missing, or dispatch without review evidence.

The Desk also joins two different review moments. Final checks produce Proof over one commit; landing consumes that Proof and human authority. Lifecycle actions may mutate Git, task resources, or landing authority after their first survey. A person needs the stored Proof and actual diff before landing, and the live lifecycle plan and consequences before confirming an effect.

The design system owns CLI Component frames. The Desk still owns the product composition: which action fits the task, which evidence belongs in review, and how the operator returns after an external reader exits.

## Decision

[`DESK_ACTION_REGISTRY`](../../../src/engine/desk/model.ts) is the single action-fact authority. Its exhaustive record is keyed by `DESK_ACTIONS` and owns each action's group, contextual label, command evidence, consequence account, No-default or no-confirmation policy, availability predicate with exact reason, and recommendation predicate. A decision contains every action exactly once. At most one available action moves into Recommended; known refusals remain disabled in their semantic group.

Provider-specific agent labels and command arguments remain in the provider registry. Project Script identity and resolved executable evidence remain project-authored discovery facts. The Desk action registry composes those authorities without copying their command declarations.

Every material effect crosses the review composition in [`desk.ts`](../../../src/engine/desk/desk.ts) and the package-backed [`reading.ts`](../../../src/engine/desk/reading.ts). Lifecycle actions show the read-only core plan, command, and consequences in a bounded reader. Tab reaches confirmation choices without moving the plan into terminal history. Apply reads current state again after confirmation; a menu predicate never authorizes an effect. Mutating confirmations default to No, and Drop keeps its typed branch challenge before discarding refused work.

`done` dispatches the same Gate core as `discern done`. Clean commits without current Proof recommend final checks. Honored Proof recommends review and landing. Grant creation and revocation remain interactive Desk capabilities with read-only plan functions and apply-time revalidation; they do not gain JSON or MCP mutation routes.

Proof review renders the stored line and Markdown page, complete commit subjects, Diffstat, changed and uncommitted paths, collisions, landing authority, and available structured Standard evidence through package Components. The stored page crosses the existing shared Markdown renderer unchanged.

Actual diffs cross [`src/lib/pager.ts`](../../../src/lib/pager.ts), the explicit pager process boundary shared with documentation readers. `$PAGER` retains its conventional shell-command contract; the default command is exactly `less -R`. Pager failures return to the Desk as typed review failures. Editor commands take `$VISUAL` before `$EDITOR`, parse a bounded command-and-arguments form, reject shell syntax, verify the executable, and spawn without a shell.

The public action table is a checked-in projection of the registry. A parity test compares the complete marked block, including action order, labels, groups, command evidence, and confirmation policy. The generated CLI reference continues to derive the `desk` command summary from the live command tree.

## Consequences

- Adding an action requires one registry member and dispatch coverage. Closed-set tests reject missing metadata, availability cases, command evidence, confirmation policy, or runtime effect coverage.
- Missing provider binaries, malformed task configuration, unavailable scripts, and lifecycle blockers remain visible facts instead of becoming indistinguishable absences.
- The Desk can change recommendation priority without changing dispatch or lifecycle validation. Registry order resolves simultaneous predicates deterministically.
- A successful Gate returns to a refreshed Proof-led task view. A refusal remains inside that task with its exact command and next action, then triggers a new survey.
- Long Proof pages and diffs remain copyable through established Markdown and pager boundaries. Desk-local Markdown parsing and replacement pager frames are forbidden.
- Grant and revoke plans add read-only observation functions beside their human-only writers. The writer and remover still revalidate after confirmation.

## Alternatives considered

- **Keep action facts in dispatcher branches.** Rejected because presentation, eligibility, safety, and documentation could drift independently.
- **Hide unavailable actions.** Rejected because absence cannot distinguish unconfigured capability from a configured capability that needs recovery.
- **Let more than one action be recommended.** Rejected because the Desk's job is to make the next human decision smaller, not reproduce every plausible route at equal weight.
- **Run final checks as a child `discern` process.** Rejected because it would duplicate CLI orchestration, weaken core identity, and complicate Proof refresh.
- **Render Proof or diff content in a Desk-specific reader.** Rejected because Markdown and pager behavior already have shared authorities and external readers preserve copy and navigation conventions.
- **Execute editor values through a shell.** Rejected because review needs exact, visible command arguments and no expansion beyond the configured command.
