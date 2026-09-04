# ADR 0151: The desk starts tasks and opens agents

**Status**: accepted. Builds on [ADR 0031](0031-typed-provider-integration.md) and [ADR 0043](0043-registry-derived-agent-parity.md) (provider-owned integration behavior), [ADR 0058](0058-start-verb-spawn-worktree-from-trunk.md) and [ADR 0109](0109-worktree-start-optional-name.md) (task creation), and [ADR 0119](0119-bare-discern-opens-the-operators-desk.md) (the operator surface).

## Context

The desk supervises work only after a worktree exists. Starting a change still means leaving the desk, running `discern start`, copying or entering the returned path, and launching a coding agent separately. That gap is most visible when the fleet is empty: the operator opens the place meant to manage work and finds no way to begin it.

Entering an existing worktree has the same friction. Jump in and Project Scripts already establish the useful pattern — launch an inherited-terminal process with the selected checkout as its current directory, block while it owns the terminal, then survey again — but coding-agent commands differ by provider. Fresh and resumed sessions also have distinct semantics. Guessing one generic resume flag, inspecting private vendor session state, or hard-coding vendor branches in the desk would make the provider registry cease to be the source of truth.

Desktop apps are a separate lifecycle problem. Handing a worktree to a long-lived app can outlive the terminal process and the checkout itself: accepting or dropping the task removes that path. The first release needs the high-confidence terminal path without claiming those detached lifecycle semantics are settled.

## Decision

**The desk is both an ingress and supervisory surface: its root menu starts tasks, and each healthy worktree can open a configured coding-agent CLI that is available on `PATH`.**

- `Start a task` prompts for an optional name and invokes the existing `startResult` lifecycle core. Blank input preserves random-codename behavior. After setup succeeds, the desk focuses the new worktree's action menu so the operator can enter it immediately.
- Agent availability is the intersection of the selected checkout's committed `[project].agents` and a live scan of the provider registry's known binaries on `PATH`. Neither side is a fallback: detected-only agents stay hidden, and configured-but-unavailable agents cannot be selected.
- Every provider declares terminal actions in the typed provider registry. Each declaration contains a stable menu label and command arguments for starting fresh and, where supported, continuing through that provider's own session flow. Parity tests require every provider to account for a fresh-session action.
- Launches pass command arguments directly, inherit stdin/stdout/stderr, and set the selected worktree as current directory. The desk blocks until the agent exits and then re-surveys. It echoes a safely quoted CLI equivalent for teaching and transcript legibility, but does not execute through a shell.
- The first release is CLI-only. It does not inspect private session stores, accept user-authored launcher templates, or launch Codex/Claude desktop apps. Desktop handoff remains a recorded exploration until its app and worktree lifecycle behavior is explicit.

## Consequences

- An empty desk can create ready work, and a created task goes directly to the choice between agent, shell, script, and the existing supervisory actions.
- Branch-local configuration remains authoritative. A branch that changes its configured agent set gets its own menu on the next survey.
- Provider command drift has one maintenance point and a class-level guard, but discern now owns the accuracy of those command declarations.
- PATH availability is intentionally dynamic UI state. Installing or removing a CLI changes what the next desk survey offers without rewriting `discern.toml`.
- Terminal agents have simple ownership: exiting returns control to the desk. Desktop integration remains unavailable until it can preserve equally honest lifecycle behavior.

## Alternatives considered

- **Treat agent launch commands as Project Scripts.** Rejected because they are provider behavior shared by every project, not project-owned automation, and making users repeat them would discard the typed registry's forcing function.
- **Hard-code Claude and Codex buttons in the desk.** Rejected because adding or changing a provider would require a second vendor switch and the other configured agents would become arbitrary second-class integrations.
- **Offer one generic continue action.** Rejected because provider resume semantics and command arguments differ; an inaccurate continue can cross project boundaries or select unintended state.
- **Launch desktop apps in the first release.** Deferred because detached processes and app-owned worktree behavior need a lifecycle decision, not just another command string.
