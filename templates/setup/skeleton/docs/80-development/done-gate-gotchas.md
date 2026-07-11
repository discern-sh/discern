# Done-gate gotchas

*Non-obvious ways `discern done` fails — each with its fix. The everyday gate procedure lives in [getting-started.md](getting-started.md) and [code-conventions.md](code-conventions.md); this page is the "why did it fail in a way the message didn't explain" reference.*

The gate **points an agent here when a stage fails** in a non-obvious way: when a fix/build/check/test stage exits non-zero, the gate prints a pointer to this doc (the path is `[project].gotchas_doc` in `discern.toml`). So the explanation is one step away even for an agent that has never hit the failure.

These are real failure modes, each with its fix. **If you hit a new one, add it here** — that is what keeps this page worth pointing at.

---

## Stack-independent traps

These arise from how the harness works (git worktrees, parallel stages, build artifacts, the merge check) and apply on any stack. They are seeded here so the gate has something useful to point at on day one.

### `main` advanced during your session

**Symptom.** `discern done` stops almost immediately — before the fixers, build, checks, or tests run — with a message that your branch does not contain the latest `main`. It does **not** merge for you.

**Cause.** The merge check is the gate's **first** step, fail-fast. While you were working, `main` moved, so your branch is behind it. A branch behind `main` has to integrate and re-run regardless — the integration changes the tree and discards whatever the gate computed against the pre-integration tree — so the gate refuses up front rather than spending the slow fix/build/check/test on a result you are about to throw away.

**Fix.** Commit your work, then run `discern integrate` — it brings `main` into your branch and re-materializes the generated agent files + skills in one step. (On a conflict it aborts cleanly and names the conflicting files. Resolve them with `git merge main`, commit the merge, then carry on.) Then run `discern done` again to verify the merged tree. (In the main checkout, not a worktree, this check is a no-op — there is nothing to integrate into.)

### A check passes alone but fails in the full run

**Symptom.** You run one test (or linter) over the files you changed and it is green, but the same step goes red inside `discern done`.

**Cause.** Shared state or ordering. The gate runs the full suite — often in parallel — so tests that lean on a shared resource (a file, a database row, a global, a fixed port) or that assume they run in a particular order pass in isolation and collide at scale. A targeted run never exercises the collision.

**Fix.** Make each test self-contained: own its fixtures, never assume order, and never reuse a resource another test could touch concurrently. Reproduce by running the full suite (or your stack's parallel mode) rather than a single filter. The bug is in the test's isolation, not in the gate.

### Stale build artifacts

**Symptom.** A check or test fails referencing code or assets that no longer match your source — an old compiled output, a cached bundle, a missing-from-manifest error — even though the source is correct.

**Cause.** A `build` capability produces artifacts that a later `check`/`test` stage reads, and the artifacts on disk are from a previous run (or were half-written while something read them).

**Fix.** Rebuild from clean and re-run. The gate already orders `build` (and `fix`) **before** `check`/`test` so artifacts are complete before anything reads them — so if you are hitting this, you likely ran a step by hand out of order, or a partial build was left behind. Let `discern done` run the stages in order rather than invoking a check directly against stale output.

### A merge pulled in a new dependency

**Symptom.** Right after `git merge main`, the next gate run dies in a check or test stage on a missing module/class/package — something that exists on `main` but is unknown locally.

**Cause.** In an isolated worktree (and often elsewhere), dependencies are not in version control. A merge updates the *lockfile text* but installs nothing. The new code references a dependency that was never fetched into this checkout.

**Fix.** Reinstall dependencies in this checkout (your stack's `install`/`restore`/`sync` step) **before** re-running the gate. If your toolchain has a generated index, autoloader, or classmap, regenerate it too — a merge that adds a new source path can leave the generated index stale, which some tools report as a silent bootstrap failure (an empty error, an unexpected non-zero exit) rather than a clear "not found".

### A command hangs, then fails with a timeout

**Symptom.** `discern done` sits on a stage with no further output, then — after `[gate].timeout` seconds (default 600) — fails that stage with a diagnostic that the command "timed out … without exiting". The command works fine when you run it by hand.

**Cause.** A gate command never exits. The usual culprit is a **watch-mode test runner** or a **dev server** wired into a capability. Run by hand in your terminal it may pick a single run, but the gate runs it with stdin closed, no TTY, and piped output, where many runners default to *watching* for file changes and wait forever. The gate exports `CI=1` (with `NO_COLOR` / `TERM=dumb`) to push runners into their single-run form, but one that ignores `CI` still hangs — so the timeout watchdog tree-kills the whole process group and fails the stage rather than waiting indefinitely.

**Fix.** Wire the command in its **single-run form** — the flag or script that runs once and exits, not a `--watch`/interactive mode and not a long-lived server. If the command is *legitimately* longer than the budget (a large suite), raise `[gate].timeout`; set it to `0` only to disable the bound entirely (not recommended — the gate can then hang again).

### A gate command fails with exit 127 (command not found)

**Symptom.** A capability or check fails immediately with `exit 127` and a `sh: <cmd>: not found` line — a command that runs fine in the main checkout.

**Cause.** A fresh worktree starts with only your tracked files. The tools and dependency directories that put that command on `PATH` — an untracked package `bin` directory, a local tools or cache directory, a per-checkout language environment — do not exist in the new worktree until something creates them, so the shell cannot find the command.

**Fix.** Converge those directories in every worktree with `[worktree.setup].ensure` — commands that run on every setup pass (install dependencies, build the toolchain). One-shot scaffolding that only needs to run at creation goes in `[worktree.setup].steps`. Then the command is on `PATH` wherever the gate runs.

### A failure shows up as exit 0

**Symptom.** You pipe `discern done` into `tee`, `tail`, or another command to capture its output, and it appears to succeed even though a stage clearly failed.

**Cause.** A pipeline reports the **last** command's exit code, not the gate's. The real non-zero status is masked by the pipe.

**Fix.** Run `discern done` bare so its true exit code surfaces. If you must capture output, use a method that preserves the original exit status (for example, redirect to a file rather than piping, or set your shell's `pipefail` option).

### The gate skips a step you expected it to run (scope detection)

**Symptom.** A change you made does not trigger the scope `gate`, preview, or build you expected — for example a docs-only change runs almost nothing.

**Cause.** This is by design. The gate classifies which scopes a change touched (`[scopes]` in `discern.toml`) and skips work that cannot be affected: a change confined to `neutral` paths runs no scope `gate`s and gets no preview. Classification **fails open** — a path matching no rule counts as a real code change, so an unknown path runs *more* gates, never fewer.

**Fix.** If something was skipped that should not have been, your `[scopes]` globs do not match the paths you changed — widen them. If something ran that you expected to be skipped, the path fell through to the fail-open default; add it to `neutral` (or the right scope) if it genuinely needs no gate.

---

## Project-specific traps

<!-- Add your stack's non-obvious gate failures below. -->

This section is yours to grow. As you build and hit failures the error message alone did not explain, record them here as **symptom + cause + fix** — the same shape as the entries above. Good candidates:

- A tool in one of your `[capabilities]` that fails for a reason its own output does not make clear.
- An ordering constraint specific to your build (an artifact one stage must produce before another reads it).
- A test-isolation footgun unique to your framework or test runner.
- A toolchain step a merge can invalidate (a generated file, a native build, a cache) that needs regenerating before the gate is green.

_(No project-specific traps recorded yet.)_
