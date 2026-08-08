# ADR 0106: `standards --pin` captures a measured gain and carries the gate receipt across it

> **Proof-naming amendment ([ADR 0245](0245-receipt-renamed-to-proof.md)):** The receipt-family terms in this decision now use **proof**; the decision and reasoning are unchanged.

> **Commit-attribution amendment (2026-07-28; [ADR 0203](0203-discern-co-authors-only-commits-it-composes.md)):** The standards-pin commit now passes through the shared, pathspec-limited discern commit boundary. It keeps the invoking user's author and committer identity and adds the `discern-bot` co-author trailer by default. Pinning and receipt carry-forward semantics are unchanged.

> **Identity amendment (2026-07-30; [ADR 0203](0203-discern-co-authors-only-commits-it-composes.md)):** The co-author identity is now `discern <done@discern.sh>`. Pinning and carry-forward semantics are unchanged.

> **Vocabulary amendment ([ADR 0120](0120-launch-verb-canon.md)):** Current pointers use `ratchets` → `standards`, `finish` → `done`, `graduate` → `accept`, the gate-pass artifact → the receipt; the decision and reasoning are unchanged. **Amended by [ADR 0133](0133-standards-join-the-gate.md):** two premises moved. "`done` never reads `[standards]` limits" no longer holds — the gate now verifies every limit and measures each standard — and the alternatives' rejection of "fold standards into `done`" is reversed for the terminal verb (the inner-loop half of that argument stands: `prepare` never measures). The pin-commit carry-forward remains sound on its updated footing: a pin only ever TIGHTENS limits, and a tightened limit still passes the never-loosen verification, so the commit remains gate-neutral for the vouch it forwards. **Job-model vocabulary amendment ([ADR 0168](0168-the-gate-declares-jobs.md)):** Current pointers use `[capabilities]` / `[checks.<name>]` → `[jobs]` / `[jobs.<name>]`; the decision and reasoning are unchanged.

**Status**: accepted. Extends [ADR 0067](0067-accept-validates-the-landed-tree.md) (the gate receipt), building on the plan/apply seam ([ADR 0027](0027-plan-apply-engine-execution.md)), the named-metric standards ([ADR 0003](0003-named-metric-standards.md)), and the one result envelope ([ADR 0028](0028-result-envelope-and-diagnostics.md)).

## Context

An agent that improves a metric held by a standard wants to _capture_ the gain — tighten the limit so it can never slide back. Until now that was a hand-edit to `discern.toml`, committed on its own. That routine is the problem, and it has two faces.

Follow the common success path:

1. The agent finishes its work; `discern done` is green, so a gate receipt ([ADR 0067](0067-accept-validates-the-landed-tree.md)) names the current HEAD.
2. It runs `discern standards` (on demand, not part of `done`) and a metric has improved past its limit.
3. To lock the gain in, it edits the `limit` in `discern.toml` and commits that change on its own.
4. It accepts — and `accept` re-runs the **whole gate**, because the commit in step 3 moved HEAD and the step-1 receipt is now stale.

The step-4 re-run is the most expensive one the tree can trigger (`discern.toml` is scope-classified as a code change, so the full gate fires), on the most common success path, for a change that **cannot alter the gate's outcome**: `done` never reads `[standards]` limits (standards are deliberately not part of it — [ADR 0003](0003-named-metric-standards.md)). A commit that changes only standard limits is therefore gate-neutral by construction.

The hand-edit is the other face. A raw number typed into `discern.toml` cannot tell a genuine tightening from a quiet loosening — exactly the "loosening buried in a feature branch" the standard discipline exists to forbid — and it puts the fiddly work of reading the measurement and re-typing the limit on the agent.

## Decision

**Add `discern standards --pin`: measure, tighten each asked-for limit that improved to the value just measured, commit that change alone, and carry an honored gate receipt forward across the (gate-neutral) commit.**

- **Only ever tightens.** The pin value is a pure function (`pinnedLimit`): it moves the limit toward the measurement — a floor up, a ceiling down — and returns "nothing to pin" unless the result is _strictly tighter_ than the current limit, whatever the margin. Pin can never loosen a limit, so it is never the escape hatch the never-loosen rule guards against. A metric that _regressed_ is a failing standard, and pin refuses to run while any standard is red — you cannot capture a good state from a bad tree.
- **A `margin` for metrics that drift.** Pinning to the _exact_ measurement bricks a metric that changes on every unrelated commit: a binary size pinned to its exact bytes fails the next commit, and can't be loosened without tripping the never-loosen guard. The optional per-standard `margin` (default 0) is the headroom pin leaves — floor `measured − margin`, ceiling `measured + margin` — and doubles as the threshold below which a gain is too small to bother pinning. A deterministic metric (coverage on a fixed tree) keeps margin 0; a drifting one gets headroom.
- **Carries the receipt forward, fail-closed.** Pin captures the receipt status _before_ it changes anything; after committing it re-stamps the vouch onto the new clean HEAD only when the prior receipt was honored — reusing `done`'s own receipt-write path. With no honored prior vouch it does nothing, leaving the now stale receipt for `accept` to re-validate. It only ever forwards a vouch that genuinely held a moment ago, across a commit it authored and so knows touched nothing but standard limits.
- **The carry-forward belongs to the mutator, not to accept.** Scope classification is path-based; it cannot see that only `[standards]` limits moved _inside_ `discern.toml` (the same file also holds `[jobs]`, which the gate does read). Only the operation that authored the commit has that knowledge, so the vouch is re-stamped where it is _known_ safe — never inferred from a diff after the fact.
- **A mode of the standards verb, on the existing seams.** Pin runs through the same plan/apply core ([ADR 0027](0027-plan-apply-engine-execution.md)) and returns the one standards result envelope ([ADR 0028](0028-result-envelope-and-diagnostics.md)); the CLI flag and the `discern_standards` MCP `pin` parameter share it. It needs a clean worktree, so the commit carries the limit change and nothing else.

## Consequences

- **The success path stops paying for a redundant gate.** The `done` → `standards --pin` → `accept` path re-runs the gate zero times: the pin commit inherits the `done` vouch, so accept takes its fast path. The one expensive, common, provably-pointless re-run is gone.
- **Re-pinning is a first-class operation, not a hand-edit.** The tedious read-the-number-and-retype step disappears, and because pin _structurally_ cannot loosen, the "capture a gain" path can no longer be confused with a quiet loosening. The hand-edit survives only for its legitimate remaining use — _loosening_ a mis-set limit, a deliberate decision recorded in its own commit.
- **Structural neutrality, not a heuristic.** The "only standard limits changed" half of the safety argument is guaranteed — pin authored the commit. The "`done` ignores those limits" half is the single assumption, true for discern (verified: the gate's codegen documents the `[standards]` schema, never a project's live limit values) and for any project whose gate does not read discern's own config namespace. It is the same best-effort posture as ADR 0067's environment-drift residual, and fail-closed: a pin that cannot confirm a clean prior vouch simply carries none, and accept re-runs.
- **`margin` is backward-compatible.** Its default of 0 leaves every existing standard pinning to the exact measurement; a project opts a drifting metric into headroom only when it wants to.

## Alternatives considered

- **Reorder the workflow — standard before the final `done` run.** Guidance only, no engine change. It fights the grain: standards are on-demand and you don't learn a metric improved until you run them, which needs a clean tree, which means you've usually already finished. A discipline patch for a structural gap — brittle, and it doesn't survive any further post-`done` commit.
- **A content-keyed receipt, or accept honoring a stale receipt when the diff is gate-neutral.** Covers the whole class of gate-neutral post-`done` commits, but makes `accept` _infer_ neutrality from a diff it didn't author — parse both `discern.toml`s, prove only `[standards]` moved — a weaker guarantee than the mutator that _knows_, with more surface, and it dilutes ADR 0067's clean identity model. Deferred until a second expensive instance of the class actually appears; the standard re-pin is the only common, full-gate member today, and it admits the stronger fix.
- **Fold standards into `done` (or a `done --pin-standards`).** Reintroduces the slow measurement into the inner loop the standards/`done` split ([ADR 0003](0003-named-metric-standards.md)) deliberately keeps it out of.
- **Pin to the exact measured value always, no margin.** Simpler, but bricks any metric that drifts on unrelated commits — the pinned ceiling fails the next commit and can't be loosened without tripping the never-loosen guard. `margin` is the guard that makes pin safe to reach for.
