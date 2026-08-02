---
aliases:
  - gate troubleshooting
  - unexpected gate failure
  - discern done failed
  - test passes alone
---

# Gate gotchas

_Non-obvious ways the `done` gate fails — each with its fix. The everyday gate procedure lives in [getting-started.md](getting-started.md) and [code-conventions.md](code-conventions.md); this page is the "why did it fail in a way the message didn't explain" reference._

The gate **points an agent here when a stage fails** in a non-obvious way: when a fix/build/check/test stage exits non-zero, the engine's gotchas wiring ([`src/engine/gate/gotchas.ts`](../../../src/engine/gate/gotchas.ts)) prints a pointer to this doc (the path is `[project].gotchas_doc` in `discern.toml`). The explanation is one step away on a first encounter. An entry can go one step further: a fenced `gotcha-match` block (TOML: `stage` matching the failure's `failed_stage`, and/or `evidence`, a regular expression over the failure's diagnostic messages and output — parsed and matched by [`gotcha_match.ts`](../../../src/engine/gate/gotcha_match.ts)) lets the gate recognize the failure and inline the entry directly into the failure output. The first matching entry in document order wins, and a malformed block warns by entry name at failure time ([ADR 0189](../_adr/0189-a-matched-gotchas-trap-inlines-into-the-gate-failure.md)).

These are real failure modes, each with its fix. **If you hit a new one, add it here** — that is what keeps this page worth pointing at.

---

## Stack-independent traps

These arise from how discern works (git worktrees, parallel stages, build artifacts, the merge check) and apply on any stack. They are seeded here so the gate has something useful to point at on day one.

### `main` advanced during your session

**Symptom.** `discern done` stops before the fixers, build, checks, or tests run. Its message says that your branch lacks the latest `main`. You perform the update separately.

**Cause.** The fail-fast merge check is the gate's first step (ADR 0049). While you were working, `main` moved, so your branch is behind it. Updating changes the tree and requires a fresh gate run. The precondition avoids spending the slower stages on the superseded tree.

**Fix.** Commit your work, then run `discern update`. It brings `main` in and re-materializes the agent files and skills. On a conflict it aborts cleanly and names the files. Resolve them with `git merge main`, commit the merge, then carry on. Run `discern done` again to verify the merged tree. In the main checkout this check is a no-op because there is no branch to update.

### A generated or local discern artifact was force-added

**Symptom.** `discern status` warns that discern-managed ignored artifacts are tracked by Git, or `discern done` stops before running jobs with `failed_stage: "tracked_artifacts"`. The named files are usually agent files (`AGENTS.md`, `CLAUDE.md`, `GEMINI.md`), materialized Skills, or machine-local provider state under `.claude/`.

**Cause.** The file matches the discern-owned `.gitignore` block, but someone used `git add -f` or otherwise forced it into the index. The reviewable source is `project/guidance.md`, `[skills].dir`, or provider config. A generated or local artifact remains untracked even when its bytes are current.

**Fix.** Remove it from the index without deleting the working-tree copy: `git rm -r --cached -- <path...>`. Then run `discern refresh` to rebuild any generated artifacts that are missing, commit the index change, and re-run `discern done`.

```gotcha-match
stage = "tracked_artifacts"
```

### A gate stage dirtied a file you already committed

**Symptom.** `done` reaches the end with every stage green, then reports uncommitted changes on tracked files (`failed_stage: "tree_drift"`). The diagnostic names each file and the stage that produced it, such as a Markdown reflow from the fix stage or a regenerated artifact from the build stage.

**Cause.** The fix stage (here `deno fmt`) mutates by design, and another stage can mutate because of its wiring. Here the build stage's `deno task codegen` rewrites tracked schema, type, and reference files. If you commit a generated file outside its canonical form, the next `done` rewrites it and leaves an uncommitted result. The gate attributes the change to its stage and blocks it from following `accept` into the main checkout.

**Fix.** The diff is the gate's output from the named stage. Review it (`git diff`), commit it (`git add -A && git commit`), and re-run `done`. You can avoid that extra pass by running `done` or `prepare` before your final commit. Tree drift applies only when a stage changes an already-committed file.

```gotcha-match
stage = "tree_drift"
```

### A generator changes the tree after every regeneration commit

**Symptom.** `discern done` reports `failed_stage: "generated_drift"`. The diagnostic names a `[generated.<name>]` group, its command, and the files it rewrote. You run that command, commit the regeneration, and rerun the gate. The same files become dirty again immediately.

**Cause.** The generator does not produce stable bytes from the same tree. Timestamps, random values, environment-dependent content, and unsorted input traversal are common causes. A `generated-coverage` diagnostic is a related declaration failure: the Build group changed files that match none of the configured `paths` globs ([ADR 0247](../_adr/0247-generated-artifacts-regenerate-never-merge.md)).

**Fix.** Remove the unstable input or make its ordering and formatting deterministic. Run the named `reproduce_cmd`, review the files, commit the regeneration, and rerun `discern done`. For `generated-coverage`, widen the responsible group's `paths` to include every committed artifact it writes.

```gotcha-match
stage = "generated_drift"
```

### A check passes alone but fails in the full run

**Symptom.** You run one test (or linter) over the files you changed and it is green, but the same step goes red inside `discern done`.

**Cause.** Shared state or ordering. The gate often runs the full suite in parallel. Tests that depend on a shared resource (a file, a database row, a global, or a fixed port) or a particular order can pass in isolation and collide at scale. A targeted run misses that collision.

**Fix.** Make each test self-contained, with its own fixtures, no ordering dependency, and no resource another test can touch concurrently. Reproduce with the full suite or your stack's parallel mode. Repair the test's isolation.

### Stale build artifacts

**Symptom.** A check or test fails while referencing code or assets that no longer match your source. The stale reference may be an old compiled output, a cached bundle, or a missing-from-manifest error.

**Cause.** A `build` job produces artifacts that a later `check`/`test` stage reads, and the artifacts on disk are from a previous run (or were half-written while something read them).

**Fix.** Rebuild from clean and re-run. The gate orders `build` and `fix` before `check` and `test`, ensuring complete artifacts before anything reads them. This failure usually follows a manually out-of-order step or a partial build. Let `discern done` run the stages in order.

### A merge pulled in a new dependency

**Symptom.** Right after `git merge main`, the next gate run dies in a check or test stage on a missing module/class/package — something that exists on `main` but is unknown locally.

**Cause.** In an isolated worktree (and often elsewhere), dependencies are absent from version control. A merge updates the _lockfile text_ but installs nothing. The new code references a dependency that has not been fetched into this checkout.

**Fix.** Reinstall dependencies in this checkout (your stack's `install`/`restore`/`sync` step) **before** re-running the gate. If your toolchain has a generated index, autoloader, or classmap, regenerate it too. A merge that adds a source path can leave the generated index stale, which some tools report as a blank bootstrap failure or an unexplained non-zero exit.

### A command hangs, then fails with a timeout

**Symptom.** `discern done` sits on a stage with no further output. After `[gate].timeout` seconds (default 600), it fails that stage with a diagnostic that the command "timed out … and was killed". The command works when you run it by hand.

**Cause.** A gate command fails to finish. The usual culprit is a **watch-mode test runner** or a **dev server** wired into a job. In your terminal it may choose a single run. The gate runs it with stdin closed, no TTY, and piped output, where many runners watch for file changes and wait indefinitely. The gate exports `CI=1` with `NO_COLOR` and `TERM=dumb` to select single-run behavior. A runner that ignores `CI` still hangs, so the timeout watchdog kills the process group and fails the stage. Another variant occurs when the command exits but leaves a background process holding its output stream open. The watchdog handles it as a timeout and releases the held pipes after killing the group.

**Fix.** Wire the command in its **single-run form**, using the flag or script that runs once and exits. Exclude `--watch`, interactive modes, and long-lived servers. If the command legitimately needs more time than the budget, raise `[gate].timeout`. Setting it to `0` disables the bound and permits another indefinite hang.

```gotcha-match
evidence = 'timed out after \d+s and was killed'
```

### A gate command fails with exit 127 (command not found)

**Symptom.** A job fails immediately with `exit 127` and a `sh: <cmd>: not found` line — a command that runs fine in the main checkout.

**Cause.** A fresh worktree starts with only your tracked files. The command may depend on an untracked package `bin` directory, a local tools or cache directory, or a per-checkout language environment. Those directories appear only after setup, so the shell cannot find the command beforehand.

**Fix.** Put checkout-generic install, restore, or sync commands under `[repository].ensure`. Discern runs them in every managed worktree and after acceptance updates the main checkout. Use `[worktree.setup].ensure` for commands that need a worktree's identity, port, or resources. Put one-shot scaffolding under `[worktree.setup].steps` ([ADR 0153](../_adr/0153-repository-owns-shared-checkout-convergence.md)).

One command can never be the missing one: `discern` itself. The engine prepends a self-shim to every operator command's `PATH` ([`self_shim.ts`](../../../src/shared/self_shim.ts), [ADR 0182](../_adr/0182-operator-commands-resolve-discern-to-the-running-engine.md)), so a job like the seeded `format = "discern tidy"` resolves to the engine running the gate even in an environment with no discern on `PATH` — CI driving the engine from source, or an MCP server spawned with a stripped environment.

```gotcha-match
evidence = 'failed \(exit 127\)'
```

### A failure shows up as exit 0

**Symptom.** You pipe `discern done` into `tee`, `tail`, or another command to capture its output, and it appears to succeed even though a stage clearly failed.

**Cause.** A pipeline reports the **last** command's exit code. The pipe masks the gate's non-zero status.

**Fix.** Run `discern done` bare to see its true exit code. If you must capture output, use a method that preserves the original exit status, such as redirecting to a file or enabling your shell's `pipefail` option.

### The gate skips a step you expected it to run (scope detection)

**Symptom.** A change you made does not trigger the scope `gate`, preview, or build you expected — for example a docs-only change runs almost nothing.

**Cause.** This is by design. The gate classifies which scopes a change touched (`[scopes]` in `discern.toml`) and skips work that cannot be affected: a change confined to a `neutral` scope runs no scope `gate`s and gets no preview. Classification **fails open**. A path matching no scope counts as a real code change and runs additional gates.

**Fix.** If something was skipped that should not have been, your `[scopes]` globs do not match the paths you changed — widen them. If something ran that you expected to be skipped, the path fell through to the fail-open default; add it to `neutral` (or the right scope) if it genuinely needs no gate.

---

## Project-specific traps

<!-- Add your stack's non-obvious gate failures below. -->

This section is yours to grow. As you build and hit failures the error message alone did not explain, record them here as **symptom + cause + fix** — the same shape as the entries above. Good candidates:

- A tool in one of your `[jobs]` that fails for a reason its own output does not make clear.
- An ordering constraint specific to your build (an artifact one stage must produce before another reads it).
- A test-isolation trap unique to your framework or test runner.
- A toolchain step a merge can invalidate (a generated file, a native build, a cache) that needs regenerating before the gate is green.

_(No project-specific traps recorded yet.)_
