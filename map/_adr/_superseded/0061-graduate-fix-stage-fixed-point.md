# ADR 0061: Graduate enforces the fix stage's fixed point before landing

> **Retired — superseded by
> [ADR 0067](../0067-accept-validates-the-landed-tree.md).** Graduate now
> validates the whole gate at the landing boundary (fast-pathed by a gate-pass
> receipt), subsuming this fix-stage-only guard. Kept for history.

**Status**: superseded by
[ADR 0067](../0067-accept-validates-the-landed-tree.md), which runs the WHOLE
gate at the graduate landing boundary (fast-pathed by a gate-pass receipt),
subsuming this fix-stage-only guard — a fix-stage strand is now caught as a
`fix_drift` gate failure. The context below records why graduate gained a
landing-boundary guard at all; ADR 0067 broadens it from the fix stage to the
full gate.

Originally accepted as: extends the fix-stage strand check
([ADR 0047](../0047-fix-stage-strand-detection.md)) from `finish` to the
`graduate` landing boundary, reusing the same `D1 \ D0` signal (`fixDriftPaths`)
and tracked-only snapshot (`worktreeDirtyPaths`).

## Context

Unformatted Markdown kept landing on `main`, and the friction kept surfacing
**downstream**: an agent in another worktree would `integrate` main, its fix
stage would reflow a doc the merge brought in, and it had to commit a pure
`deno fmt` reformat it never authored (e.g. commit `0ae3e2e`). The committed ADR
that triggered one such round was itself **not** `deno fmt`-clean on `main` — so
the leak was upstream, at the moment the doc was graduated.

[ADR 0047](../0047-fix-stage-strand-detection.md) made `finish` block when the
fix stage strands a reformat on a committed-clean file. It works — but it lives
**inside `finish`**, and its reasoning leaned on one external guard: _"CI
already guards this, with a `git diff --exit-code` after finish."_ That
assumption does not hold for this repo's local workflow:

- An agent treats a docs change as exempt from the full gate — _"only one doc
  paragraph changed, so the check is the prose linter"_ — and runs **only the
  `docs/` scope gate** (Vale). A prose linter **lints**; it never **formats**.
  `deno fmt` lives solely in the fix stage of `finish`, which the agent skipped.
  So the unformatted doc is committed.
- `graduate --to trunk` fast-forwards `main` **locally** and deletes the branch.
  There is no PR and **no CI**, so neither `finish`'s strand check (skipped) nor
  CI's `git diff --exit-code` (never runs) sees the unformatted commit.
- Other worktrees then `integrate` from that **local** `main`, and each one eats
  the reflow. The cost lands on the innocent downstream agent, every time.

The gap is structural: the fmt-clean property was enforced only by a `finish`
the agent can skip and a CI the local graduate bypasses. Nothing re-checked it
at the one boundary that actually writes to `main` — `graduate` trusted that a
clean `finish` had run.

## Decision

**`graduate` re-runs the fix stage and refuses to land a branch that is not at
its fixed point** — the same property CI's trailing `git diff --exit-code`
asserts, brought to the local landing boundary.

- **One signal, defined once.** `detectFixStageStrand` runs the configured
  fix-stage fixers and reports the stranded set `D1 \ D0` via the same
  `worktreeDirtyPaths` (tracked-only) + `fixDriftPaths` primitives `finish` uses
  ([ADR 0047](../0047-fix-stage-strand-detection.md)). "Not at the fixed point"
  means exactly the same thing in both verbs; neither re-defines it.
- **In the apply phase, not the diagnosis.** The guard runs the fixers (a
  mutation), so it sits in `executeGraduatePlan`, after the read-only
  preconditions and **before** any teardown/removal. `--dry-run` returns the
  plan from the read-only diagnosis and never reaches it — a preview still
  touches nothing.
- **It refuses; it does not commit.** A gate is not a committer
  ([ADR 0047](../0047-fix-stage-strand-detection.md)). The reformat is left
  applied in the worktree; the refusal names the files and says to review with
  `git diff`, commit, and re-run. The branch keeps all its commits, and the
  worktree is intact (the refusal precedes every destructive step).
- **A broken fixer refuses too.** A fixer command that exits non-zero yields
  `fixFailed`, and graduate refuses rather than land a branch it could not
  verify. A project with no fix stage is a clean no-op.

## Consequences

- **Unformatted output cannot land on `main` via local graduate.** The agent
  either commits the reformat (it lands formatted) or re-runs as-is (graduate's
  WIP-commit captures the now-formatted tree). The recurring downstream
  `integrate` reflow disappears at its source.
- **Graduate runs the fixers every time** — one extra `deno fmt` pass per
  graduation. The fix stage is fast and graduation is infrequent; the cost buys
  a hard guarantee at the boundary that matters.
- **New untracked files land clean too.** The strand check is tracked-only (it
  inherits ADR 0047's scope), but because the fixers run **before** graduate's
  `git add -A` WIP-commit, a whole-tree fixer like `deno fmt` formats a
  brand-new untracked doc before it is committed.
- **The guard and `finish` are tied by a regression test.** A committed-unclean
  file fails `finish` with `fix_drift` _and_ is refused by `graduate`; a
  fix-stage-clean branch passes both. Weakening one without the other breaks the
  suite.

## Alternatives considered

- **Run the whole `finish` gate in graduate.** The strongest invariant ("nothing
  that fails the gate lands"), and it would catch lint/test failures too.
  Rejected for now: it runs the test suite on every graduation, slow across many
  parallel worktrees, and the observed, recurring class is specifically the fix
  stage. The targeted guard removes that class without taxing every land.
- **Fix it in agent guidance only** (teach agents that a docs change still needs
  the full gate). Rejected: guidance is compiled into every end-user's agent
  files and must stay lean, and a behavioural nudge cannot make the regression
  structurally impossible — an agent that rationalizes skipping the gate would
  still strand output. The guard holds regardless of what the agent ran.
- **Auto-format and commit during graduate.** Rejected on the same principle as
  ADR 0047: graduate silently scooping up fixer output is the surprise that ADR
  motivated removing, not reintroducing. Surface it; let the agent commit it.
