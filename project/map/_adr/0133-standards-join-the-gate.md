# ADR 0133: Standards join the gate — verified always, measured by default

**Status**: accepted. Supersedes [ADR 0003](0003-named-metric-standards.md)'s on-demand split _as it applies to the gate verb_ and reverses the "fold standards into finish" rejection in [ADR 0106](0106-standards-pin-carries-the-gate-receipt.md)'s alternatives (amendment notes on both). Extends [ADR 0112](0112-standard-measurement-receipt.md) (the gate now records the measurement receipt) and [ADR 0108](0108-gate-job-timeout.md) (the per-job `timeout` override its deferral waited for). Builds on the plan/apply seam ([ADR 0027](0027-plan-apply-engine-execution.md)), the result envelope ([ADR 0028](0028-result-envelope-and-diagnostics.md)), and the receipt ([ADR 0114](0114-the-gate-emits-the-receipt.md)).

## Context

The product's flagship claim — a standard is a number "a branch can never loosen" — was advice, not structure. The gate only _hinted_ that standards exist. ADR 0106 recorded "finish never reads `[standards]` limits", and the receipt carried no standards knowledge. A branch that loosened a limit in `discern.toml`, or deleted the table outright, landed clean through `done` → `accept`. That violated design principle 10 (structure over advice) at exactly the claim the launch copy leads with — and the rename to "standards" amplified the gap: the adversarial design review conditioned the name on enforcement shipping alongside it.

The historical split had sound reasons at the time. ADR 0003 kept measurements out of `finish` because the inner loop must stay fast — but the inner loop is `prepare` now, and the terminal claim verb already runs the whole test suite. A measurement that runs _in parallel with_ those tests costs wall-clock only when it is slower than the slowest test job.

## Decision

**Two tiers, both inside `done`.**

**Tier 1 — the never-loosen verification, always.** Every real gate run checks every configured `[standards]` limit against the trunk's committed config, as a fail-fast precondition placed directly after the merge check. The placement has three reasons. It is the cheapest precondition after the merge check (one git read, milliseconds). It guards the exact config that produced every later job table. And the merge check must precede it so the baseline is the freshest merged-in trunk copy. A loosened limit fails the gate with a diagnostic naming the standard and both values — and so does a deleted entry, because deletion is the ultimate loosening, so Tier 1 also walks the trunk's own table. A standard new on the branch passes vacuously, as does a trunk with no config. **Not configurable**: an escape hatch here would defeat the guarantee the product leads with.

The unverifiable-trunk posture: when the trunk ref does not resolve at all (an unborn repo, a CI clone that never fetched it), Tier 1 skips **loudly** — a warning, an `unverified` disclosure in the envelope and receipt, and a hint naming the fix (fetch the trunk where the gate runs). A trunk config that was _fetched_ but does not parse fails hard: a broken trunk config is a real defect, not one to skip past. Never a silent pass either way.

**Tier 2 — measurement by default, per-standard opt-out.** A standard that is never measured protects nothing, so each standard's `run` executes as an ordinary job inside the existing parallel check∥test group. It runs under the same scheduler semantics as every other job (fail-fast, buffered capture, the per-job timeout), and the same evaluation as the standalone verb judges it (the metric line decides, never the exit code). A measured metric past its limit fails the gate like any failing check, with measured-vs-limit diagnostics and the exact reproduce command. Dirty trees measure as-is, exactly as the tests do. Per-standard durations land in the envelope and receipt, so a deferral rests on data.

Three proportionate reliefs, smallest hammer first, before a metric leaves the gate:

1. **Input-keyed replay.** A standard may declare `inputs` — the globs the metric reads, in the scope-paths vocabulary, matched by the same matcher the scopes use. When every changed path falls outside the inputs, the gate replays the recorded value — loudly: the step, envelope, and receipt all read "replayed from `<sha>` (inputs unchanged)". The changed-path set is the committed diff since the baseline **plus** dirty working-tree paths, with renames decomposed to delete + add by the one shared `--no-renames` diff reader — a metric file renamed away IS a change. The baseline is the nearest recorded measurement reachable from HEAD: the worktree's own measurement receipt, else the trunk checkout's (ADR 0112's chain extended, never duplicated). Replay is no escape hatch — a replayed value is a real measurement of an identical input set, still compared against the branch's _current_ limit. Omitted `inputs` always measures (the conservative default).
2. **A per-job `timeout`** (the value-shape decision ADR 0108 deferred until a real case arrived): a capability value gains the table form (`{ run = "…", timeout = N }`), and `[checks.<name>]`, `[scopes.<name>]`, and `[standards.<name>]` take the same optional key — replacing the global budget for that one job only.
3. **`measure = "on-demand"`** defers the _measurement_ of a pathologically slow metric to `discern standards`. Tier 1 still covers its limit on every gate run, and the gate's hints name every deferral.

**What is preserved.** `prepare` stays measurement-free — the ADR 0003 split survives exactly where its argument holds, the inner loop. The standalone `standards` verb always measures (never replays), so pinning and CI stay full-fat, and its clean-tree rule stands for its receipt/pin duties. Auto-pin stays rejected (ADR 0112): a green gate run now _records_ the measurement receipt — durations included, merged into a same-HEAD receipt rather than clobbering a fuller one — but _capturing_ a gain remains the explicit `--pin`. The everyday path `done` → `--pin` → `accept` measures once and re-runs the gate zero times.

**The legitimate-loosening story.** With Tier 1 on every branch, a deliberate loosening (a mis-set limit) can no longer land quietly. V1 keeps it simple and honest, written for the reader the failure actually has — an agent. The Tier-1 hint tells that agent to relay the finding to its owner, and states that lowering a limit is an owner decision taken on the trunk: at the owner's explicit instruction, an agent working in the main checkout edits the limit in the trunk's `discern.toml`, in daylight, in trunk history. The owner decides in a sentence, and nobody hand-edits TOML unprompted.

Zero cost when `[standards]` is empty: the gate plan is byte-identical to a standards-free gate (pinned structurally by a test).

## Consequences

- **The launch claim is mechanically true.** An agent cannot lower a standard, and by default cannot regress one, on any path through the gate to `accept` — while a change that touches no metric's inputs pays seconds, and a project with one unfathomably slow metric defers that single metric without surrendering the never-loosen guarantee.
- **The envelope and receipt grew** (`data.standards[]`, `data.standards_limits`, the receipt's standards section and verification line), through the result-schema codegen, so the wire contract and the MCP output schemas stay tied to reality.
- **The failed-stage vocabulary gained `standards`** — a compile error at every consumer until handled, per the closed-set discipline.
- **Existing installs change behaviour on upgrade**: standards previously measured only on demand now measure on every `done`. The keys are additive (no migration); the template documents the relief ladder, and the honest fix for a too-slow default is `inputs`, a bigger per-job budget, or an explicit deferral — never a quieter gate.

## Alternatives considered

- **Measurement at `accept` instead of `done`.** Rejected: it concentrates arbitrary slowness at the most ceremonial moment in the lifecycle, after the review conversation has already happened — and a regression discovered at landing is a regression discovered too late to iterate on cheaply.
- **Opt-in measurement (`measure = "gate"` off by default).** Rejected: the default is the product, and with an opt-in default metric regressions keep slipping silently through exactly the runs that should catch them.
- **An annotation/reset escape for deliberate loosening** (a marker commit, a dedicated verb, a one-run override). Deferred: the trunk-edit flow covers the rare legitimate case with a visible commit, and every escape mechanism weakens the guarantee's legibility. Revisit only on real-world evidence that trunk edits are too blunt.
- **A content-keyed Tier 1 (hash the `[standards]` table instead of comparing limits).** Rejected: it would flag harmless reordering and comment edits while still needing the per-limit comparison for honest diagnostics.
