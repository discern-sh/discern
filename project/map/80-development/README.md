---
aliases:
  - contributor guide
  - development
  - contribute to discern
  - work on discern
---

# Working on this project

_How contributors set up the checkout, change code, run the checks, and prepare a release._

This subtree documents local setup, the testing approach, the conventions the tooling enforces, and the recovery reference for a Gate failure whose immediate diagnostic needs more context. The Gate is the project's final quality check.

Contributors use the same `discern <verb>` commands as installed projects. In this repository, the local-development wrapper runs each command against the current checkout's Engine:

- `start` provisions an isolated workspace for one task (a Git worktree). See the worktree rule in the project instructions.
- `prepare` is the fast inner loop. It applies fix-stage work, regenerates declared artifacts, completes refresh convergence, then runs check-stage work. Other build jobs and tests stay omitted.
- `done` runs the full Gate. In a worktree, it first verifies that the branch contains the latest trunk. It then runs the fix-stage and build-stage work, runs `check` and `test` in parallel, and fires the Gate for each changed scope that declares one. Run it on the intended final commit. Follow the first diagnostic, then run `discern done` again.

## Leaves

| File                                                         | What's in it                                                                                                                                                                                                        |
| ------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [ambient-process-state.md](ambient-process-state.md)         | Where authored code may read env or cwd, why host modules are registered boundaries, how trunk resolution stays singular, and how the Gate prevents new ambient coupling.                                           |
| [done-gate-gotchas.md](done-gate-gotchas.md)                 | Gate failures that need context beyond the immediate diagnostic: merge checks, parallel-run state, stale artifacts, masked exit codes, and project-specific entries. The Gate links this page when a stage fails.   |
| [install-surface.md](install-surface.md)                     | What `discern setup` lays down in a project, mapped by function, with each part's project-owned / shared / generated ownership and where to change it.                                                              |
| [for-humans.md](for-humans.md)                               | Maintainer prerequisites, editor settings for JetBrains and VS Code, and the actions used alongside coding-agent work.                                                                                              |
| [getting-started.md](getting-started.md)                     | From a fresh clone to a first green Gate: prerequisites (Deno, Git), running the tool from source, and the discern loop.                                                                                            |
| [testing.md](testing.md)                                     | The two test layers: installer and Engine subprocesses that drive `src/main.ts` against the real templates, the isolated temporary-directory and Git fixture, and the parallel-isolation patterns the Gate assumes. |
| [reviewing-terminal-output.md](reviewing-terminal-output.md) | The real-PTY see-judge-adjust loop for terminal changes: capture before and after, inspect the visual browser rendering, hand off the HTML path, and review flagship fixture diffs.                                 |
| [canon-editor.md](canon-editor.md)                           | Canon Editor edits the five prose registries through their generated pages, with annotated fields, typed pickers, save-and-prove write-back, live register lint, and guard-net enrolment.                           |
| [code-conventions.md](code-conventions.md)                   | What the fix-stage and check-stage work enforces, plus the File ownership, strict TypeScript, and documentation conventions that require contributor judgment.                                                      |
| [runtime-data-boundaries.md](runtime-data-boundaries.md)     | How JSON files, subprocess reports, caches, and linter output validate before use, while each caller retains its own absence and recovery policy.                                                                   |
