# ADR 0312: `worktrees` opens a cwd-equivalent child shell

**Status**: accepted; complements the supervisory Desk in [ADR 0119](0119-bare-discern-opens-the-operators-desk.md) and [ADR 0151](0151-the-desk-starts-tasks-and-opens-agents.md), and uses the owned-child lifecycle from [ADR 0159](0159-inherited-terminal-children-have-one-owned-lifecycle.md).

## Context

The Desk can open a shell in a selected worktree, but it is a main-checkout supervisory loop. Reaching that action takes a task selection and an action selection, and the shell always starts at the selected worktree root. A person working several directories deep in one checkout needs a smaller sideways-navigation operation that preserves their place.

A command process cannot change the working directory of the shell that invoked it. Printing a path or shell fragment could let a shell function perform a lasting `cd`, but then the command's behavior would depend on installation-specific shell integration and evaluation. discern already owns inherited-terminal child processes and can provide useful movement without mutating the parent.

The worktree menu also needs branch, Git, Proof, and activity facts. Recomputing them beside `status` or the Desk would create another fleet model that could drift.

## Decision

**`discern worktrees` is a one-shot interactive picker that starts a child shell in another registered worktree.** It runs from any discern checkout. The plural top-level verb is the fleet navigation surface; the lifecycle subcommands remain under `discern worktree …`.

The picker surveys the main checkout through `statusResult(..., { all: true })`. Registered worktrees use `StatusFleetEntry` and the Desk's shared compact row summary. The current checkout is visible but cannot be selected. Unavailable worktrees, unlanded branches without checkouts, and reclaimed contained branches also remain visible but cannot be selected. Only an available, non-current checkout can launch.

The launch directory preserves the invoking shell's path relative to its current project root. If that exact directory is absent in the selected checkout, discern chooses the nearest existing ancestor within that checkout and reports the fallback. Path resolution never escapes either project root.

Selection starts the shell named by `$SHELL`, with `/bin/sh` as the shared fallback used by the Desk. `runOwnedChild` owns the inherited terminal and interrupt lifecycle. Exiting the child returns to the original parent shell and its unchanged directory.

The command makes no project or Git changes. It refuses JSON and non-interactive execution with a route to `discern status --all`; it has no Model Context Protocol (MCP) tool because terminal selection and shell ownership are the operation. Its controlled JSON refusal still has a registered result contract.

## Consequences

- A person can move between parallel worktrees in one selection while retaining project-relative context.
- The parent shell's directory never changes. Each move adds one shell nesting level until that child exits.
- Branch-local directory differences degrade to a reported ancestor instead of failing or escaping the selected checkout.
- Status remains the authority for fleet facts, while the picker owns only availability, selection, directory mapping, and launch.
- The new top-level verb enrolls in command help, setup gating, vocabulary, result contracts, shell-only MCP accounting, and verb parity guards.

## Alternatives considered

- **Add only a faster route inside the Desk.** Rejected because the Desk remains main-only, supervisory, and stateful, while this operation must work from any checkout and finish after one launch.
- **Print the selected path.** Rejected because it leaves cwd mapping, quoting, and shell integration to every caller and does not provide the requested immediate handoff.
- **Emit shell code for `eval` or require a shell function.** Rejected as the default because evaluating generated code expands the trust boundary and requires per-shell installation. A future print-only mode can be added independently if persistent parent-shell navigation proves valuable.
- **Attempt to change the parent process directory.** Rejected because a child process cannot do so.
- **Recompute Git and worktree state in the picker.** Rejected because `status` already owns those facts and the Desk already provides their compact row wording.
