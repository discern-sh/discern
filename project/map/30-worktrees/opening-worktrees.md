---
title: Open another worktree
description: Choose another checkout and open a child shell at the matching project-relative directory.
order: 100
aliases:
  - discern enter
  - switch worktrees
  - worktree shell picker
---

# Open another worktree

_`discern enter` moves sideways across the [fleet](../00-orientation/glossary.md#fleet) without losing your place in the project tree._

Run it from any discern checkout in an interactive terminal:

```sh
discern enter
```

The menu derives its facts from `discern status --all`. It shows the main checkout and every registered worktree with its branch, Git state, [Proof](../20-quality-gate/the-proof.md) state, recent activity, and path. The menu keeps the current checkout visible but does not let you select it. Unavailable checkouts, unlanded branches without a checkout, and [reclaimed stage branches](reclaiming-contained-worktrees.md) also stay visible as non-selectable context.

Selecting a worktree starts `$SHELL` as a child process. If the command starts in `src/engine`, the child shell starts in `src/engine` under the selected worktree. When that exact directory does not exist on the selected branch, discern warns and uses the nearest existing ancestor, stopping at the selected worktree's root.

Exit the child shell to return to the original shell and directory. A child process cannot change its parent's directory, so the command does not attempt to persist a `cd` after it exits ([ADR 0312](../_adr/0312-worktrees-opens-a-cwd-equivalent-child-shell.md)).

The picker never creates, updates, lands, or removes a worktree. Use the [lifecycle commands](lifecycle.md) for those effects. Outside a terminal, use the status view instead:

```sh
discern status --all
discern status --all --json
```

There is no Model Context Protocol (MCP) tool for `worktrees`: an agent can read the same fleet facts through `discern_status`, while terminal ownership and the child shell remain CLI concerns.

## Where it lives in code

| Responsibility                  | Source                                                                |
| ------------------------------- | --------------------------------------------------------------------- |
| Picker, cwd mapping, and launch | [`shell_picker.ts`](../../../src/engine/worktree/shell_picker.ts)     |
| Fleet facts                     | [`status.ts`](../../../src/engine/status/status.ts)                   |
| Shared row wording              | [`model.ts`](../../../src/engine/desk/model.ts)                       |
| Shared shell resolution         | [`user_shell.ts`](../../../src/engine/user_shell.ts)                  |
| Behavioral and terminal tests   | [`engine_worktrees_test.ts`](../../../tests/engine_worktrees_test.ts) |
