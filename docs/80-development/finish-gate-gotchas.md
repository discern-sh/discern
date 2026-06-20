# Finish-gate gotchas

_Non-obvious ways the `finish` gate fails — each with its fix. The everyday gate
procedure lives in [getting-started.md](getting-started.md) and
[code-conventions.md](code-conventions.md); this page is the "why did it fail in
a way the message didn't explain" reference._

The gate **points an agent here when a stage fails** in a non-obvious way: when
a fix/build/check/test stage exits non-zero, the engine's gotchas wiring
([`src/engine/gate/gotchas.ts`](../../src/engine/gate/gotchas.ts)) prints a
pointer to this doc (the path is `[project].gotchas_doc` in
`.icculus/config.toml`). So the explanation is one step away even for an agent
that has never hit the failure.

These are real failure modes, each with its fix. **If you hit a new one, add it
here** — that is what keeps this page worth pointing at.

---

## Stack-independent traps

These arise from how the harness works (git worktrees, parallel stages, build
artifacts, the merge check) and apply on any stack. They are seeded here so the
gate has something useful to point at on day one.

### `main` advanced during your session

**Symptom.** Every stage passes, then `deno task dev finish` stops at the very
end with a message that your branch does not contain the latest `main`. It does
**not** merge for you.

**Cause.** The merge check is the gate's **final** step, deliberately — so you
fix all the real failures first and integrate `main` once, cleanly, at the end.
While you were working, `main` moved.

**Fix.** Commit your work, run `git merge main`, resolve any conflicts and
commit the merge, then run `deno task dev finish` again to verify the merged
result. (In the main checkout, not a worktree, this check is a no-op — there is
nothing to integrate into.)

### A check passes alone but fails in the full run

**Symptom.** You run one test (or linter) over the files you changed and it is
green, but the same step goes red inside `deno task dev finish`.

**Cause.** Shared state or ordering. The gate runs the full suite — often in
parallel — so tests that lean on a shared resource (a file, a database row, a
global, a fixed port) or that assume they run in a particular order pass in
isolation and collide at scale. A targeted run never exercises the collision.

**Fix.** Make each test self-contained: own its fixtures, never assume order,
and never reuse a resource another test could touch concurrently. Reproduce by
running the full suite (or your stack's parallel mode) rather than a single
filter. The bug is in the test's isolation, not in the gate.

### Stale build artifacts

**Symptom.** A check or test fails referencing code or assets that no longer
match your source — an old compiled output, a cached bundle, a
missing-from-manifest error — even though the source is correct.

**Cause.** A `build` capability produces artifacts that a later `check`/`test`
stage reads, and the artifacts on disk are from a previous run (or were
half-written while something read them).

**Fix.** Rebuild from clean and re-run. The gate already orders `build` (and
`fix`) **before** `check`/`test` so artifacts are complete before anything reads
them — so if you are hitting this, you likely ran a step by hand out of order,
or a partial build was left behind. Let `deno task dev finish` run the stages in
order rather than invoking a check directly against stale output.

### A merge pulled in a new dependency

**Symptom.** Right after `git merge main`, the next gate run dies in a check or
test stage on a missing module/class/package — something that exists on `main`
but is unknown locally.

**Cause.** In an isolated worktree (and often elsewhere), dependencies are not
in version control. A merge updates the _lockfile text_ but installs nothing.
The new code references a dependency that was never fetched into this checkout.

**Fix.** Reinstall dependencies in this checkout (your stack's
`install`/`restore`/`sync` step) **before** re-running the gate. If your
toolchain has a generated index, autoloader, or classmap, regenerate it too — a
merge that adds a new source path can leave the generated index stale, which
some tools report as a silent bootstrap failure (an empty error, an unexpected
non-zero exit) rather than a clear "not found".

### A failure shows up as exit 0

**Symptom.** You pipe `deno task dev finish` into `tee`, `tail`, or another
command to capture its output, and it appears to succeed even though a stage
clearly failed.

**Cause.** A pipeline reports the **last** command's exit code, not the gate's.
The real non-zero status is masked by the pipe.

**Fix.** Run `deno task dev finish` bare so its true exit code surfaces. If you
must capture output, use a method that preserves the original exit status (for
example, redirect to a file rather than piping, or set your shell's `pipefail`
option).

### The gate skips a step you expected it to run (scope detection)

**Symptom.** A change you made does not trigger the scope `gate`, preview, or
build you expected — for example a docs-only change runs almost nothing.

**Cause.** This is by design. The gate classifies which scopes a change touched
(`[scopes]` in `.icculus/config.toml`) and skips work that cannot be affected: a
change confined to a `neutral` scope runs no scope `gate`s and gets no preview.
Classification **fails open** — a path matching no scope counts as a real code
change, so an unknown path runs _more_ gates, never fewer.

**Fix.** If something was skipped that should not have been, your `[scopes]`
globs do not match the paths you changed — widen them. If something ran that you
expected to be skipped, the path fell through to the fail-open default; add it
to `neutral` (or the right scope) if it genuinely needs no gate.

---

## Project-specific traps

<!-- Add your stack's non-obvious gate failures below. -->

This section is yours to grow. As you build and hit failures the error message
alone did not explain, record them here as **symptom + cause + fix** — the same
shape as the entries above. Good candidates:

- A tool in one of your `[capabilities]` (or a `[checks.<name>]`) that fails for
  a reason its own output does not make clear.
- An ordering constraint specific to your build (an artifact one stage must
  produce before another reads it).
- A test-isolation footgun unique to your framework or test runner.
- A toolchain step a merge can invalidate (a generated file, a native build, a
  cache) that needs regenerating before the gate is green.

_(No project-specific traps recorded yet.)_
