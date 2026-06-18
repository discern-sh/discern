# Working on this project

_The contributor's view of the codebase — set up, write, test, ship._

This subtree documents the developer experience: getting set up locally, the
testing approach, the conventions the tooling enforces, and where to look when
the quality gate fails in a way the message did not explain.

The end-to-end loop is short and the same on every stack the harness runs on:

- `agent worktree` provisions an isolated checkout for a change (see the
  worktree note in the project guidelines).
- `agent tidy` is the fast inner loop — it applies the `fix` slots, then the
  `check` slots, and never builds or tests.
- `agent finish` is the full gate: it runs the `fix`/`build` slots, then `check`
  and `test` in parallel, fires any side gates whose scope changed, and (in a
  worktree) verifies your branch contains the latest `main`. Run it before
  declaring any change done; fix what it reports and re-run.

## Leaves

| File                                             | What's in it                                                                                                                                                                                                             |
| ------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| [finish-gate-gotchas.md](finish-gate-gotchas.md) | Non-obvious ways `agent finish` fails — the stack-independent traps (merge check, parallel-run state, stale artifacts, masked exit codes), plus a section for your stack's own. The gate points here when a phase fails. |
| [install-surface.md](install-surface.md)         | What `icculus init` lays down in a project, mapped by function, with the managed / seed / merged / generated disposition of each part and where to change it.                                                            |
| [for-humans.md](for-humans.md)                   | What a human with the repo checked out does: IDE colour/exclude setup (JetBrains + VS Code), local prerequisites, and how to work alongside the agents.                                                                  |
| [getting-started.md](getting-started.md)         | From a fresh clone to a first green gate: prerequisites (Deno, git, shellcheck), running the Installer from source, and the harness loop.                                                                                |
| [testing.md](testing.md)                         | The two test layers (installer subprocess + engine shell-out), the temp-dir / hermetic-git harness, and the parallel-safe patterns the gate assumes.                                                                     |
| [code-conventions.md](code-conventions.md)       | What the `fix`/`check` slots enforce, and the conventions they can't — the managed-vs-seed golden rule, shell portability, and the docs discipline.                                                                      |
