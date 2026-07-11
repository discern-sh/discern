# ADR 0106: `ratchets --pin` captures a measured gain and carries the gate-pass receipt across it

**Status**: accepted. Extends
[ADR 0067](0067-graduate-validates-the-landed-tree.md) (the gate-pass receipt),
building on the plan/apply seam
([ADR 0027](0027-plan-apply-engine-execution.md)), the named-metric ratchets
([ADR 0003](0003-named-metric-ratchets.md)), and the one result envelope
([ADR 0028](0028-result-envelope-and-diagnostics.md)).

## Context

An agent that improves a ratcheted metric wants to _capture_ the gain — tighten
the limit so it can never slide back. Until now that was a hand-edit to
`discern.toml`, committed on its own. That routine is the problem, and it has
two faces.

Follow the common success path:

1. The agent finishes its work; `discern finish` is green, so a gate-pass
   receipt ([ADR 0067](0067-graduate-validates-the-landed-tree.md)) names the
   current HEAD.
2. It runs `discern ratchets` (on demand, not part of `finish`) and a metric has
   improved past its limit.
3. To lock the gain in, it edits the `limit` in `discern.toml` and commits that
   change on its own.
4. It graduates — and `graduate` re-runs the **whole gate**, because the commit
   in step 3 moved HEAD and the step-1 receipt is now stale.

The step-4 re-run is the most expensive one the tree can trigger (`discern.toml`
is scope-classified as a code change, so the full gate fires), on the most
common success path, for a change that **cannot alter the gate's outcome**:
`finish` never reads `[ratchets]` limits (ratchets are deliberately not part of
it — [ADR 0003](0003-named-metric-ratchets.md)). A commit that changes only
ratchet limits is therefore gate-neutral by construction.

The hand-edit is the other face. A raw number typed into `discern.toml` cannot
tell a genuine tightening from a quiet loosening — exactly the "loosening buried
in a feature branch" the ratchet discipline exists to forbid — and it puts the
fiddly work of reading the measurement and re-typing the limit on the agent.

## Decision

**Add `discern ratchets --pin`: measure, tighten each asked-for limit that
improved to the value just measured, commit that change alone, and carry an
honored gate-pass receipt forward across the (gate-neutral) commit.**

- **Only ever tightens.** The pin value is a pure function (`pinnedLimit`): it
  moves the limit toward the measurement — a floor up, a ceiling down — and
  returns "nothing to pin" unless the result is _strictly tighter_ than the
  current limit, whatever the margin. Pin can never loosen a limit, so it is
  never the escape hatch the never-loosen rule guards against. A metric that
  _regressed_ is a failing ratchet, and pin refuses to run while any ratchet is
  red — you cannot capture a good state from a bad tree.
- **A `margin` for metrics that drift.** Pinning to the _exact_ measurement
  bricks a metric that changes on every unrelated commit: a binary size pinned
  to its exact bytes fails the next commit, and can't be loosened without
  tripping the never-loosen guard. The optional per-ratchet `margin` (default 0)
  is the headroom pin leaves — floor `measured − margin`, ceiling
  `measured + margin` — and doubles as the threshold below which a gain is too
  small to bother pinning. A deterministic metric (coverage on a fixed tree)
  keeps margin 0; a drifting one gets headroom.
- **Carries the receipt forward, fail-closed.** Pin captures the receipt status
  _before_ it changes anything; after committing it re-stamps the vouch onto the
  new clean HEAD only when the prior receipt was honored — reusing `finish`'s
  own receipt-write path. With no honored prior vouch it does nothing, leaving
  the now stale receipt for `graduate` to re-validate. It only ever forwards a
  vouch that genuinely held a moment ago, across a commit it authored and so
  knows touched nothing but ratchet limits.
- **The carry-forward belongs to the mutator, not to graduate.** Scope
  classification is path-based; it cannot see that only `[ratchets]` limits
  moved _inside_ `discern.toml` (the same file also holds `[capabilities]`,
  which the gate does read). Only the operation that authored the commit has
  that knowledge, so the vouch is re-stamped where it is _known_ safe — never
  inferred from a diff after the fact.
- **A mode of the ratchets verb, on the existing seams.** Pin runs through the
  same plan/apply core ([ADR 0027](0027-plan-apply-engine-execution.md)) and
  returns the one ratchets result envelope
  ([ADR 0028](0028-result-envelope-and-diagnostics.md)); the CLI flag and the
  `discern_ratchets` MCP `pin` parameter share it. It needs a clean worktree, so
  the commit carries the limit change and nothing else.

## Consequences

- **The success path stops paying for a redundant gate.** `finish` →
  `ratchets
  --pin` → `graduate` re-runs the gate zero times: the pin commit
  inherits the finish vouch, so graduate takes its fast path. The one expensive,
  common, provably-pointless re-run is gone.
- **Re-pinning is a first-class operation, not a hand-edit.** The tedious
  read-the-number-and-retype step disappears, and because pin _structurally_
  cannot loosen, the "capture a gain" path can no longer be confused with a
  quiet loosening. The hand-edit survives only for its legitimate remaining use
  — _loosening_ a mis-set limit, a deliberate decision recorded in its own
  commit.
- **Structural neutrality, not a heuristic.** The "only ratchet limits changed"
  half of the safety argument is guaranteed — pin authored the commit. The
  "`finish` ignores those limits" half is the single assumption, true for
  discern (verified: the gate's codegen documents the `[ratchets]` schema, never
  a project's live limit values) and for any project whose gate does not read
  discern's own config namespace. It is the same best-effort posture as ADR
  0067's environment-drift residual, and fail-closed: a pin that cannot confirm
  a clean prior vouch simply carries none, and graduate re-runs.
- **`margin` is backward-compatible.** Its default of 0 leaves every existing
  ratchet pinning to the exact measurement; a project opts a drifting metric
  into headroom only when it wants to.

## Alternatives considered

- **Reorder the workflow — ratchet before the final finish.** Guidance only, no
  engine change. It fights the grain: ratchets are on-demand and you don't learn
  a metric improved until you run them, which needs a clean tree, which means
  you've usually already finished. A discipline patch for a structural gap —
  brittle, and it doesn't survive any further post-finish commit.
- **A content-keyed receipt, or graduate honoring a stale receipt when the diff
  is gate-neutral.** Covers the whole class of gate-neutral post-finish commits,
  but makes `graduate` _infer_ neutrality from a diff it didn't author — parse
  both `discern.toml`s, prove only `[ratchets]` moved — a weaker guarantee than
  the mutator that _knows_, with more surface, and it dilutes ADR 0067's clean
  identity model. Deferred until a second expensive instance of the class
  actually appears; the ratchet re-pin is the only common, full-gate member
  today, and it admits the stronger fix.
- **Fold ratchets into `finish` (or a `finish --pin-ratchets`).** Reintroduces
  the slow measurement into the inner loop the ratchets/finish split
  ([ADR 0003](0003-named-metric-ratchets.md)) deliberately keeps it out of.
- **Pin to the exact measured value always, no margin.** Simpler, but bricks any
  metric that drifts on unrelated commits — the pinned ceiling fails the next
  commit and can't be loosened without tripping the never-loosen guard. `margin`
  is the guard that makes pin safe to reach for.
