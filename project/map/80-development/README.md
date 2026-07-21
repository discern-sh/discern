# Working on this project

_The contributor's view of the codebase — set up, write, test, ship._

This subtree documents the developer experience: getting set up locally, the testing approach, the conventions the tooling enforces, and where to look when the quality gate fails in a way the message did not explain.

The loop is short and the same on every stack discern runs on. You drive it with `discern <verb>`; in this repo the local-dev wrapper runs that command against the current checkout's engine, as an end user would:

- `start` provisions an isolated checkout for a change (see the worktree note in the project guidance).
- `prepare` is the fast inner loop: it applies the fix-stage work, then the check-stage work, omitting build and test stages.
- `done` is the full gate: in a worktree, it first verifies that your branch contains the latest trunk. It then runs the fix- and build-stage work, runs `check` and `test` in parallel, and fires any scope `gate`s whose scope changed. Run it before declaring any change done; fix what it reports and re-run.

## Leaves

| File                                         | What's in it                                                                                                                                                                                                       |
| -------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| [done-gate-gotchas.md](done-gate-gotchas.md) | Non-obvious ways the gate fails — the stack-independent traps (merge check, parallel-run state, stale artifacts, masked exit codes), plus a section for your stack's own. The gate points here when a stage fails. |
| [install-surface.md](install-surface.md)     | What `discern setup` lays down in a project, mapped by function, with each part's project-owned / shared / generated ownership and where to change it.                                                             |
| [for-humans.md](for-humans.md)               | What a human with the repo checked out does: IDE color/exclude setup (JetBrains + VS Code), local prerequisites, and how to work alongside the agents.                                                             |
| [getting-started.md](getting-started.md)     | From a fresh clone to a first green gate: prerequisites (Deno, git), running the tool from source, and the discern loop.                                                                                           |
| [testing.md](testing.md)                     | The two test layers (installer subprocess + engine subprocess driving `src/main.ts` against the real templates), the temp-dir / hermetic-git fixture, and the parallel-safe patterns the gate assumes.             |
| [code-conventions.md](code-conventions.md)   | What the fix- and check-stage work enforces, and the conventions they can't: file ownership, strict TypeScript, and the docs discipline.                                                                           |
