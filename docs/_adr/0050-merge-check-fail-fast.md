# ADR 0050: Run the merge check first, as a fail-fast precondition

**Status**: accepted

## Context

`discern finish` checked whether the branch contains the latest `main` — the
**merge check** — as its **last** step, after the fix/build/check∥test stages,
the scope gates, and the guidance/skills/`fix_drift` currency checks
([finish.ts](../../src/engine/gate/finish.ts), the `runGate` ordering).

The merge check is nearly free: `assertMainMerged`
([git.ts](../../src/engine/worktree/git.ts)) runs `show-ref --verify` then
`merge-base --is-ancestor main HEAD`, and a `rev-list --count` only when the
branch is actually behind (purely to report how far). It self-skips in the main
checkout and outside a worktree — there is nothing to integrate into. So a
millisecond-scale precondition sat gated behind the entire expensive gate.

That ordering is a tax on the harness's own headline workflow. With several
agents in flight, `main` moves often. An agent on a branch behind `main` paid
the full cost of the gate — fixers, build, the parallel check/test run — only to
be told at the end to integrate `main` and re-run. And that work is **wasted by
construction**: `git merge main` changes the tree, which forces a fresh
`finish`, so every result computed against the pre-integration tree is discarded
unread. The gate spent its most expensive stages producing a throwaway answer.

Crucially, the merge-base relationship is **invariant across a gate run**:
`finish` never fetches and never commits, so neither `HEAD` nor `main` moves
while it executes. Checking at the front therefore returns exactly the same
verdict as checking at the back.

## Decision

**Move the merge check to the first step of `runGate`, fail-fast.** When the
branch is behind `main`, the gate sets `failed_stage = "merge"` and skips every
downstream stage; the fix-set snapshot and the stage-group loop are guarded so
nothing expensive runs. The result envelope is still assembled from the same
plan, so the skipped capabilities/scope-gates serialize as `skipped` steps — an
honest record that they were never reached.

Because the verdict is invariant across the run (above), this is a pure
reordering, not a change to _what_ the gate decides — only to _when_, and to how
much it spends before deciding. The `--dry-run` plan lists the `merge-check`
step first to match the executed order.

## Consequences

- **Behind `main`:** the gate stops before any capability runs, saving the whole
  fix/build/check∥test/scope-gate/currency sweep — the case that compounds
  across parallel agents.
- **Happy path in a worktree:** one extra `merge-base --is-ancestor` at the
  front, and nothing else.
- **Main checkout / outside a worktree:** unchanged — `assertMainMerged`
  self-skips, so the precondition is a no-op there exactly as the trailing check
  was.
- **The contract holds.** `failed_stage = "merge"` and the `DiscernResult` shape
  are unchanged; only the moment it is determined moves. When behind, steps
  serialize as `skipped` rather than `ok` (they genuinely did not run).
- **The inner loop is unaffected.** `prepare` (fix + check) and `discern test`
  never ran the merge check, so an agent behind `main` can still iterate
  locally; only `finish` — the "am I done?" gate — fails fast.
- **Relationship to `fix_drift`**
  ([ADR 0047](0047-fix-stage-strand-detection.md)): the strand check no longer
  runs _before_ the merge check — the merge check now precedes it. 0047 is
  annotated accordingly.
- **Regression guard.** A new engine test drives `finish` in a worktree behind
  `main` and asserts `failed_stage = "merge"` with the expensive capability
  reported `skipped` (not run) — pinning the fail-fast order so a future change
  cannot quietly drop the merge check back to the end.

## Alternatives considered

- **Keep it last.** Rejected — it is the status quo that burns the wasted run.
  Its apparent virtue ("see all your real failures first, integrate once at the
  end") is hollow: those failures must be re-surfaced against the _integrated_
  tree on the forced re-run regardless, so checking them first against a doomed
  tree buys nothing.
- **Auto-integrate `main` inside `finish`** (`git merge main` when behind and
  clean, then gate the merged tree, so no re-run is needed). Rejected — it makes
  a pure _check_ verb mutate the branch and can throw merge conflicts mid-gate,
  breaking discern's `finish`-is-a-check / `graduate`-is-the-mutation split.
  Fail-fast captures most of the win with none of the surprise.
- **Make it advisory** (warn, but still run the stages). Rejected — a branch
  behind `main` is not "done", so the gate must stay red; and running the slow
  stages against a tree that is about to be replaced is the precise waste this
  removes.
