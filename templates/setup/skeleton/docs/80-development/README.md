# Working on this project

_The contributor's view of the codebase — set up, write, test, ship._

This subtree documents the developer experience: getting set up locally, the testing approach, the conventions the tooling enforces, and where to look when the quality gate fails in a way the message did not explain.

> The leaves marked below are skeletons. `discern setup` and the `discern-document-subsystem` skill fill them once the project's stack is known. The [gate gotchas](done-gate-gotchas.md) leaf already carries the stack-independent traps and is ready to grow.

The end-to-end loop is short and the same on every stack discern runs on:

- `discern start` creates an isolated worktree for a change and moves you into it (see the worktree note in the project instructions).
- `discern prepare` is the fast inner loop — it applies fix-stage jobs, regenerates `[generated]` artifacts, completes refresh convergence, then runs check-stage jobs; other build jobs and tests stay with `discern done`.
- `discern done` is the full gate: it runs the fix/build-stage jobs, then the `check` and `test` stages in parallel, fires any scope `gate`s that fired, and (in a worktree) verifies your branch contains the latest `main`. Run it before declaring any change done; fix what it reports and re-run.

## Leaves

| File                                         | What's in it                                                                                                                                                                                                             |
| -------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| [done-gate-gotchas.md](done-gate-gotchas.md) | Non-obvious ways `discern done` fails — the stack-independent traps (merge check, parallel-run state, stale artifacts, masked exit codes), plus a section for your stack's own. The gate points here when a stage fails. |
| `getting-started.md`                         | _Skeleton — fill during `discern setup`._ Cloning, the worktree step, environment setup, running the app, the first `discern done`.                                                                                      |
| `testing.md`                                 | _Skeleton — fill during `discern setup`._ The testing approach in this repo, how to run tests, and the parallel-safe patterns the gate assumes.                                                                          |
| `code-conventions.md`                        | _Skeleton — fill during `discern setup`._ The rules the tooling enforces, mirroring the Conventions section of the project instructions.                                                                                 |
