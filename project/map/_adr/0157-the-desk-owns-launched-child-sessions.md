# ADR 0157: The desk owns its launched child sessions

**Status**: accepted; extends [ADR 0119](0119-bare-discern-opens-the-operators-desk.md) and [ADR 0151](0151-the-desk-starts-tasks-and-opens-agents.md)

## Context

The desk blocks while a Jump in shell, coding-agent command, or Project Script owns its terminal. When that child exits, the desk surveys the fleet again. Nothing identified the child as part of that suspended interaction, however. A user could invoke `discern desk` from the child, follow the existing linked-worktree redirect to the main checkout, and open a second desk while the first still waited underneath it.

Shell nesting is not the right signal. `SHLVL` varies by shell and starting environment, coding agents and Project Scripts are processes rather than necessarily shells, and walking the parent-process tree would be platform-specific. Worktree location is also insufficient because a child can change directory to the main checkout.

## Decision

**Every arbitrary-code child launched by the desk inherits `DISCERN_DESK_SESSION=1`, and the interactive desk refuses to start anywhere beneath that marker.**

- The two launch boundaries cover the whole current class: inherited-terminal commands serve Jump in and every provider-owned coding-agent action, while the Project Script runner serves Run script. Descendants inherit the marker normally.
- `runDesk` checks the marker before JSON-mode, terminal, project-root, fleet-survey, or checkout-location handling. The named JSON form returns `error = "desk_already_active"`; human output tells the operator to exit the shell, agent, or script and return to the owning desk. Bare `discern` reaches the same guard before its interaction policy.
- The marker records process context, not authority. A caller can add or remove it, so no lifecycle operation, project state, or health verdict depends on it. Every non-desk verb keeps its existing behavior.
- `discern doctor` includes `desk_session = true` in its structured environment block and adds a human environment line when the marker is active. It remains an informational debugging fact, never a check or warning.

This does not reverse ADR 0119's rejection of agent or vendor detection. The marker identifies an action discern itself performed; it does not guess the caller from third-party environment conventions.

## Consequences

- A desk can have one active interaction stack. Changing directories inside its child cannot accidentally create a second supervisory loop.
- Shells, all configured coding agents, and Project Scripts share one ownership rule without provider-specific branches.
- Commands and tests run beneath a desk child also inherit the marker. Because only desk entry and doctor context consume it, ordinary project automation and discern lifecycle behavior remain deterministic.
- A deliberately detached descendant may retain the marker after the owning desk resumes or exits. It can unset the variable when detachment is intentional; the marker is an accident guard, not confinement.

## Alternatives considered

- **Read `SHLVL`.** Rejected because it neither identifies the owning desk nor covers non-shell children.
- **Inspect the parent-process tree.** Rejected as platform-specific, brittle across launchers, and still unable to express discern's ownership as directly as a marker set at launch.
- **Rely on the linked-worktree refusal.** Rejected because its suggested `cd` to the main checkout removes the only condition it detects.
- **Mark only Jump in shells.** Rejected because coding agents and Project Scripts can invoke the same interactive command while the desk is blocked.
- **Make every verb desk-session-aware.** Rejected because an inherited, user-controlled marker is debugging context rather than lifecycle authority. Broader behavior would also leak ambient terminal context into project automation.
