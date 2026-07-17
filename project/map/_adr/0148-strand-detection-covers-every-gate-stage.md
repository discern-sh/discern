# ADR 0148: Strand detection covers every gate stage

**Status**: accepted; extends [ADR 0047](0047-fix-stage-strand-detection.md),
works with [ADR 0094](0094-final-lifecycle-checks-require-clean-trees.md) and
[ADR 0116](0116-receipts-vouch-only-for-the-pinned-tree.md)

## Context

ADR 0047 made `done` block when the **fix stage** strands changes on a
committed-clean tracked file, and deliberately scoped the check to that one
stage. The fix stage is the stage _meant_ to mutate; CI's trailing
`git diff --exit-code` stood as the guard for tracked mutations from non-fix
stages.

Field use showed that residual gap has the exact failure mode ADR 0047 set out
to remove. A project whose **build stage** (or a test, or a scope gate)
regenerates a tracked artifact — a project generator rewriting a tracked
manifest, a codegen step rewriting tracked schemas — dirties the tree _outside_
the fix-stage snapshot window. The gate goes green, the receipt silently refuses
(`skipped_dirty`), and the only signal is a hint riding on a green result — the
"advisory on green" pattern ADR 0047 itself rejected as the thing agents ignore.
An agent watching a long gate paid the full run, got an ambiguous green, blamed
the strand on "the formatter", and paid a second full run after a diagnosis
loop. CI's diff guard never enters that local loop.

discern's own repository carries the same shape: its build capability runs the
codegen task, which rewrites tracked schema, type, and reference files.

## Decision

**`done` blocks when _any_ stage group strands changes on a previously clean
tracked file, and the diagnostic names the stage that did it.**

- **The snapshot window widens from one stage to all.** The gate captures the
  tracked-dirty set once before any stage group runs and again after each green
  group (fix, build, check/test, scope gates). The stranded set keeps its
  spirit: paths dirty in the _final_ snapshot but not at gate start — so a stage
  reworking the agent's own uncommitted edits (the inner loop) still never
  trips, and a path a later stage restores to its committed state does not count
  (the finished tree is what the receipt vouches for).
- **Each strand is attributed to the first snapshot that shows it.** The
  diagnostic says _which stage_ produced each file — "the build stage", "a scope
  gate" — replacing the formatter-shaped guesswork the old green path invited.
  The failed-stage label is renamed `fix_drift` → `tree_drift` to match the
  widened class; the diagnostic tool label is `tree-drift`.
- **Everything else about ADR 0047 stands.** Tracked changes only (an untracked
  file a stage emits is visible in `git status` and remains a legitimate
  pattern); a final gate check that runs only when the gate is otherwise green;
  block-don't-autocommit; no toggle; the capped `git diff` and
  commit-then-re-run rescue in the diagnostic; fail-open when a snapshot cannot
  be read.

## Consequences

- **"Green but no receipt" from a gate-caused tracked mutation no longer
  exists.** The failure moves from a quiet `skipped_dirty` hint after a full run
  to a red gate with the diff and the origin stage in hand — same worst-case two
  runs, but the first run explains itself.
- **The wire vocabulary changes**: `failed_stage: "tree_drift"` replaces
  `"fix_drift"`. Schemas and types regenerate from the one vocabulary source;
  consumers switching on the closed set get a compile error until they handle
  the new label, which is the enrolment working as designed.
- **A gate job that legitimately regenerates tracked files now requires the
  regenerated output committed before `done` passes** — true for this
  repository's own codegen build step. That is the discipline ADR 0094 already
  asks for at accept time, surfaced at the point the agent is looking.
- **Cost: one extra `git status` per green stage group** (three to four per gate
  run), negligible beside the jobs themselves.
- The remaining honest gap is unchanged from ADR 0047: a stage emitting a new
  **untracked** file still leaves the worktree dirty for the receipt without
  blocking the gate — visible in `git status`, disclosed by the receipt hint
  (which now names the dirty paths), and outside CI's diff guard too.

## Alternatives considered

- **Keep the fix-stage scope and improve the green-run hint.** Rejected for the
  same reason ADR 0047 rejected advisory hints: agents key on `ok`, and a hint
  on a green gate is what gets ignored — that was the observed failure.
- **Snapshot only at gate start and end (no attribution).** Cheaper by two
  `git status` calls, but the diagnostic could not name the origin stage, and a
  wrong guess at the origin ("the formatter did this") is precisely the
  diagnosis loop this change removes.
- **A separate failed-stage label per origin stage.** Rejected: the class is one
  invariant (a green gate must leave the tracked tree as it found it); the
  origin belongs in the diagnostic, not the vocabulary.
- **Auto-commit the stranded output.** Rejected again per ADR 0047/0094: a gate
  is not a committer, and discern cannot know the commit boundary or message.
