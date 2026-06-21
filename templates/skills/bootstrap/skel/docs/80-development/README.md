# Working on this project

*The contributor's view of the codebase — set up, write, test, ship.*

This subtree documents the developer experience: getting set up locally, the testing approach, the conventions the tooling enforces, and where to look when the quality gate fails in a way the message did not explain.

> The leaves marked below are skeletons. `/bootstrap` and the [`document-subsystem`](../../.claude/skills/document-subsystem/SKILL.md) skill fill them once the project's stack is known. The [finish-gate gotchas](finish-gate-gotchas.md) leaf already carries the stack-independent traps and is ready to grow.

The end-to-end loop is short and the same on every stack the harness runs on:

- `icculus worktree` provisions an isolated checkout for a change (see the worktree note in the project guidelines).
- `icculus tidy` is the fast inner loop — it applies the fix-stage capabilities, then the check-stage capabilities, and never builds or tests.
- `icculus finish` is the full gate: it runs the fix/build-stage capabilities, then `check` and `test` in parallel, fires any scope `gate`s that fired, and (in a worktree) verifies your branch contains the latest `main`. Run it before declaring any change done; fix what it reports and re-run.

## Leaves

| File | What's in it |
|---|---|
| [finish-gate-gotchas.md](finish-gate-gotchas.md) | Non-obvious ways `icculus finish` fails — the stack-independent traps (merge check, parallel-run state, stale artifacts, masked exit codes), plus a section for your stack's own. The gate points here when a stage fails. |
| `getting-started.md` | _Skeleton — fill during `/bootstrap`._ Cloning, the worktree step, environment setup, running the app, the first `icculus finish`. |
| `testing.md` | _Skeleton — fill during `/bootstrap`._ The testing approach in this repo, how to run tests, and the parallel-safe patterns the gate assumes. |
| `code-conventions.md` | _Skeleton — fill during `/bootstrap`._ The rules the tooling enforces, mirroring the Conventions section of the project guidelines. |
