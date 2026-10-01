# ADR 0413: The Desk offers each task's next decision

**Status**: accepted; amends [ADR 0398](0398-the-desk-is-a-live-human-control-panel.md) and [ADR 0353](0353-desk-actions-are-registry-facts-reviewed-before-effects.md); builds on [ADR 0414](0414-status-owns-the-row-state-vocabulary.md)

## Context

ADR 0398 sorted tasks by title and derived no recommended action, so that overlap, Proof validity and permission could not be conflated into urgency. The result left the owner to work out each task's next step from separate facts: a fixed list of primary controls offered Accept, Join the landing queue and Drop on every task, while the step a task actually needed (update, run checks, recover) sat under More actions. Several controls stayed enabled although their lifecycle core would refuse them: queueing unproven or dirty work, accepting a task without honored Proof, and accepting a Proof whose unmet checkpoints or standard proposals the Desk cannot record. Labels were long and drifted from copy that quoted them in hints, tips, status recovery advice and plan titles.

ADR 0414 gave every surface one row-state vocabulary. Each state already says who moves next; the Desk still needed one place that says which action that is.

## Decision

The action registry declares, per action, the row states whose next step it is (`next`) and the states that offer it beside their next step (`also`). Every live state has exactly one next step; a state offers at most three alternatives, each with a key. Drop is never a next step and never an alternative for a degraded task. The Desk opens a task on its next step when that step can run, then its available alternatives; every other action stays one route away, unavailable ones listed with their reason and never run.

Tasks list by status's decision group (Ready for review, Needs attention, Working, Approved to land, Idle), then by case-folded, accent-aware title. A row's word, glyph and tone are its status row state; Proof validity, landing authority and the queue stay separate facts in the task's details. A landing's integration worktree gets no row and no actions.

Each action has one label from the copy glossary, held only in a leaf vocabulary module that the registries, the desk's views, status's row sentences and recovery advice, hints, tips, park refusals and plan titles import. The feature registry, which the Canon Editor rewrites as plain literals, types its control names instead, and each must resolve to a registered label. A label ends with an ellipsis exactly when the action asks for a confirmation or more input. The Desk names landing **Land…**; the CLI keeps `discern accept`, and the command evidence is the true equivalent, `discern accept --target <branch> --confirmed`.

The registry also declares each action's menu section, key, summary, review question, consequence lines (each with a mark and an optional fact that must hold), effect, and the facts a review binds before the effect runs. Desk-level commands live in a sibling registry with the same shape, and one key map per layer draws its mnemonics and command keys from both. Built-in plan steps have human words keyed like their stable labels.

Availability stops advertising known refusals, and only those: each unavailability mirrors a precondition the lifecycle core itself enforces. Landing and queueing need honored Proof on a clean branch with commits ahead; landing also needs the main checkout to have no tracked changes and to be on the trunk, exactly what acceptance checks before it moves the trunk. Untracked files there, and generated files out of date on main, do not block a landing: acceptance ignores the first and refreshes main's generated files after it lands. A Proof with owner decisions, or a landing copy retained for one, makes Land… and Queue for landing… unavailable with the exact hand-off command, because queue admission never decides an exception either. Opening an agent stays available while a discern command runs in the task, as [ADR 0408](0408-project-code-holds-no-exclusion-boundary.md) requires.

### Amendment to ADR 0398

The overview no longer sorts by title alone, and a recommended next step is derived again, now from registry data per status state rather than from overlap or Proof. Accept no longer keeps its product name in the Desk. Package ownership, bounded observation, generation discards, revalidation at activation, retained session state, and the independence of activity, Proof, landing authority and submission remain in force: grouping is a named projection of status's state, and granting still neither queues nor lands.

### Amendment to ADR 0353

The recommendation predicate becomes the registry's `next` and `also` lists, keyed by row state; "at most one available action moves into Recommended" becomes one next step per state plus at most three keyed alternatives. Known refusals stay disabled, now with their reason visible before activation. The public action table gains Key and Section columns and loses the contextual label.

## Consequences

The owner reads a task's state and acts on its next step without assembling it from facts, and the same state reads the same in `discern status`, `discern enter` and the Desk. Relabelling an action changes one vocabulary entry; the label guard refuses a typed copy in any shipped module, and the registry guard holds the key, ellipsis, next-step and binding rules for every action, command and state.

Rows move between groups as states change, which title order avoided. Tightened availability means fewer controls are enabled on unproven or dirty work, and actions that used to fail at review now explain themselves up front. An exception still needs a terminal: the Desk shows the command instead of recording the decision.

The pinned package cannot hand the terminal to an action from a key, so this Desk answers only its page keys; the key map is the contract the package's application runtime will serve.

## Alternatives considered

- **Keep title order and a fixed primary list.** Rejected: it hides each task's next step and keeps offering refused actions.
- **Derive next steps inside the Desk view.** Rejected: a second table beside the registry would drift from the actions' own availability and confirmation facts.
- **Let the Desk record exceptions.** Deferred: widening the Desk's consent surface deserves its own decision; the exact hand-off command is honest today.
