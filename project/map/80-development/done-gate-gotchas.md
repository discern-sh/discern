---
aliases:
  - gate troubleshooting
  - unexpected gate failure
  - discern done failed
  - test passes alone
---

# Gate gotchas

_Recovery for `discern done` failures whose immediate diagnostic needs more context. The routine Gate procedure lives in [getting-started.md](getting-started.md) and [code-conventions.md](code-conventions.md)._

When a fix, build, check, or test stage exits non-zero, the Gate links this page through the wiring in [`src/engine/gate/gotchas.ts`](../../../src/engine/gate/gotchas.ts). `[project].gotchas_doc` in `discern.toml` sets the path. A fenced `gotcha-match` block can also put an entry directly in the failure output. Its Tom's Obvious Minimal Language (TOML) fields are `stage`, which matches `failed_stage`, and `evidence`, a regular expression over diagnostic messages and output. [`gotcha_match.ts`](../../../src/engine/gate/gotcha_match.ts) parses and matches the block. The first matching entry in document order wins. A malformed block produces a warning that names the entry at failure time ([ADR 0189](../_adr/0189-a-matched-gotchas-trap-inlines-into-the-gate-failure.md)).

When a recurring failure needs context beyond its diagnostic, add a symptom, cause, fix, and optional `gotcha-match` block to this page.

---

## Stack-independent traps

These failures come from Git worktrees, parallel stages, build artifacts, and the merge check. They apply on any project stack.

### `main` advanced during your session

**Symptom.** `discern done` stops before the fixers, build, checks, or tests run. Its message says that your branch lacks the latest `main`. You perform the update separately.

**Cause.** The fail-fast merge check is the Gate's first step (ADR 0049). While you were working, `main` moved, so your branch is behind it. Updating changes the tree and requires a fresh Gate run. The precondition avoids spending the slower stages on the superseded tree.

**Fix.** Commit your work, then run `discern update`. It brings `main` in and refreshes the generated agent files and Skills. On a conflict, the command aborts the merge and names the files. Resolve them with `git merge main`, then commit the merge. Run `discern done` again to verify the merged tree. In the main checkout, this check is a no-op because there is no branch to update.

### A generated or local discern artifact was force-added

**Symptom.** `discern status` warns that discern-managed ignored artifacts are tracked by Git, or `discern done` stops before running jobs with `failed_stage: "tracked_artifacts"`. The named files are usually agent files (`AGENTS.md`, `CLAUDE.md`, `GEMINI.md`), materialized Skills, or machine-local provider state under `.claude/`.

**Cause.** The file matches the discern-owned `.gitignore` block, but `git add -f` or an equivalent operation forced it into the index. The reviewable source is `project/guidance.md`, `[skills].dir`, or provider config. A generated or local artifact remains untracked even when its bytes are current.

**Fix.** Remove it from the index without deleting the working-tree copy: `git rm -r --cached -- <path...>`. Then run `discern refresh` to rebuild any generated artifacts that are missing, commit the index change, and re-run `discern done`.

```gotcha-match
stage = "tracked_artifacts"
```

### A gate stage dirtied a file you already committed

**Symptom.** `done` reports uncommitted changes on tracked files (`failed_stage: "tree_drift"`). A run that started on a clean, committed tree stops right after the fix and build groups, with the later steps marked skipped; a run that started dirty reports at the end, after every stage. The diagnostic names each file and the stage that produced it, such as a Markdown reflow from the fix stage or a regenerated artifact from the build stage.

**Cause.** The fix stage (here `deno fmt`) is allowed to mutate files, and another stage can mutate because of its wiring. Here the build stage's `deno task codegen` rewrites tracked schema, type, and reference files. If you commit a generated file outside its canonical form, the next `done` rewrites it and leaves an uncommitted result. The Gate attributes the change to its stage and blocks it from following `accept` into the main checkout.

**Fix.** The diff is the Gate's output from the named stage. Review it (`git diff`), commit it (`git add -A && git commit`), and rerun `done`. Run `done` or `prepare` before the final commit to put generated files in canonical form first. Tree drift applies only when a stage changes an already committed file.

```gotcha-match
stage = "tree_drift"
```

### A generator changes the tree after every regeneration commit

**Symptom.** `discern done` reports `failed_stage: "generated_drift"`. The diagnostic names a `[generated.<name>]` group, its command, and the files it rewrote. You run that command, commit the regeneration, and rerun the Gate. The same files become dirty again immediately.

**Cause.** The generator does not produce stable bytes from the same tree. Timestamps, random values, environment-dependent content, and unsorted input traversal are common causes. A `generated-coverage` diagnostic is a related declaration failure: the Build group changed files that match none of the configured `paths` globs ([ADR 0247](../_adr/0247-generated-artifacts-regenerate-never-merge.md)).

**Fix.** Remove the unstable input or make its ordering and formatting deterministic. Run the named `reproduce_cmd`, review the files, commit the regeneration, and rerun `discern done`. For `generated-coverage`, widen the responsible group's `paths` to include every committed artifact it writes.

```gotcha-match
stage = "generated_drift"
```

### A check passes alone but fails in the full run

**Symptom.** You run 1 test or linter over the files you changed and it passes. The same step fails inside `discern done`.

**Cause.** Shared state or ordering. The Gate often runs the full suite in parallel. Tests that depend on a shared resource (a file, a database row, a global, or a fixed port) or a particular order can pass in isolation and collide during the parallel suite. A targeted run misses that collision.

**Fix.** Make each test self-contained, with its own fixtures, no ordering dependency, and no resource another test can touch concurrently. Reproduce with the full suite or your stack's parallel mode. Repair the test's isolation.

### Stale build artifacts

**Symptom.** A check or test fails while referencing code or assets that no longer match your source. The stale reference may be an old compiled output, a cached bundle, or a missing-from-manifest error.

**Cause.** A `build` job produces artifacts that a later `check`/`test` stage reads, and the artifacts on disk are from a previous run (or were half-written while something read them).

**Fix.** Rebuild from a clean source tree, then rerun `discern done`. The Gate orders `build` and `fix` before `check` and `test`, so later stages read the completed artifacts. This failure usually follows an out-of-order command or a partial build.

### A merge pulled in a new dependency

**Symptom.** After `git merge main`, the next Gate run fails in a check or test stage on a missing module, class, or package. The dependency exists on `main` and is absent from the local checkout.

**Cause.** In an isolated worktree, dependencies are usually absent from version control. A merge updates the lockfile text and installs nothing. The new code references a dependency that has not been fetched into this checkout.

**Fix.** Reinstall dependencies in this checkout with the stack's `install`, `restore`, or `sync` step before rerunning the Gate. If the toolchain has a generated index, autoloader, or classmap, regenerate it too. A merge that adds a source path can leave the generated index stale, which some tools report as a blank bootstrap failure or an unexplained non-zero exit.

### A command hangs, then fails with a timeout

**Symptom.** `discern done` sits on a stage with no further output. After `[gate].timeout` seconds (default 600), it fails that stage with a diagnostic that the command "timed out … and was killed". The command works when you run it by hand.

**Cause.** A Gate command fails to finish. A watch-mode test runner or development server wired into a job can create this state. In your terminal, the command may choose a single run. The Gate runs it with standard input closed, no terminal (TTY), and piped output, where many runners watch for file changes and wait indefinitely. The Gate exports `CI=1` with `NO_COLOR` and `TERM=dumb` to select single-run behavior. A runner that ignores `CI` still hangs, so the timeout watchdog kills the process group and fails the stage. The same timeout occurs when the command exits and leaves a background process holding its output stream open. The watchdog kills the group and releases the held pipes.

**Fix.** Wire the command in its single-run form, using the flag or script that runs once and exits. Exclude `--watch`, interactive modes, and long-lived servers. If the command needs more time than the budget, raise `[gate].timeout`. Setting it to `0` disables the bound and permits an indefinite hang.

```gotcha-match
evidence = 'timed out after \d+s and was killed'
```

### A gate command fails with exit 127 (command not found)

**Symptom.** A job fails immediately with `exit 127` and a `sh: <cmd>: not found` line. The same command runs in the main checkout.

**Cause.** A fresh worktree starts with only your tracked files. The command may depend on an untracked package `bin` directory, a local tools or cache directory, or a per-checkout language environment. Those directories appear only after setup, so the shell cannot find the command beforehand.

**Fix.** Put checkout-generic install, restore, or sync commands under `[repository].ensure`. discern runs them in every managed worktree and after acceptance updates the main checkout. Use `[worktree.setup].ensure` for commands that need a worktree's identity, port, or resources. Put one-shot scaffolding under `[worktree.setup].steps` ([ADR 0153](../_adr/0153-repository-owns-shared-checkout-convergence.md)).

The self-shim makes `discern` available to every operator command. The Engine prepends the shim to `PATH` ([`self_shim.ts`](../../../src/shared/self_shim.ts), [ADR 0182](../_adr/0182-operator-commands-resolve-discern-to-the-running-engine.md)), so a job such as the seeded `format = "discern tidy"` resolves to the Engine running the Gate. This also applies when CI drives the Engine from source or an MCP server starts with a stripped environment. The shim is cached once per Engine identity under the repository's Git administrative directory ([ADR 0249](../_adr/0249-self-shims-cache-per-identity-sweep-pages-stay-budget-bounded.md)).

```gotcha-match
evidence = 'failed \(exit 127\)'
```

### A failure shows up as exit 0

**Symptom.** You pipe `discern done` into `tee`, `tail`, or another command to capture its output, and it appears to succeed even though a stage clearly failed.

**Cause.** A pipeline reports the last command's exit code. The pipe masks the Gate's non-zero status.

**Fix.** Run `discern done` bare to see its true exit code. If you must capture output, use a method that preserves the original exit status, such as redirecting to a file or enabling your shell's `pipefail` option.

### The Gate skips a step you expected it to run (scope detection)

**Symptom.** A changed path does not trigger the expected scope Gate, preview, or build. For example, a documentation-only change can run almost nothing.

**Cause.** The Gate classifies which scopes a change touched (`[scopes]` in `discern.toml`) and skips work that cannot be affected. A change confined to a `neutral` scope runs no scope Gates and gets no preview. Classification fails open: a path matching no scope counts as a real code change and runs additional Gates.

**Fix.** If an expected scope Gate was skipped, widen the `[scopes]` globs to match the changed paths. If an unexpected Gate ran, the path reached the fail-open default. Add the path to `neutral` or the applicable scope only when it needs no Gate.

---

## Project-specific traps

<!-- Add your stack's non-obvious gate failures below. -->

When a project-specific failure needs context beyond its diagnostic, record it here with the existing symptom, cause, and fix fields. Good candidates include:

- A tool in one of your `[jobs]` that fails for a reason its own output does not make clear.
- An ordering constraint specific to your build (an artifact one stage must produce before another reads it).
- A test-isolation trap unique to your framework or test runner.
- A toolchain step a merge can invalidate (a generated file, a native build, a cache) that needs regenerating before the gate is green.

_(No project-specific traps recorded yet.)_
