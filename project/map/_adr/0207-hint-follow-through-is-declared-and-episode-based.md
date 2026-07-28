# ADR 0207: Hint follow-through is declared and episode-based

**Status**: accepted

## Context

Logbook events carry stable ids for hints delivered during a verb run. The original `hint-follow-through` detector measured only repeated `status-branch-behind` hints without an `update`. Other advisory families remained unmeasured.

Follow-through differs by family: red-gate remedies ask for `prepare` or `test` before another `done`, while the main-checkout hint asks for `start` before more dirty-trunk activity. A detector-side hint-id table would duplicate the registry.

The main-checkout hint reaches the agent through a `ctx.log` line outside the result envelope, so the recorder missed it. Recorded history can also lack correlation fields, end before an outcome, or contain related calls on different surfaces. Those gaps cannot support a behavioral claim.

## Decision

`HintDef` has an optional, data-only `followThrough` declaration naming a measurement family and observable rule. Definitions in one family reuse a frozen rule object. Detector functions and engine dependencies stay out of the shared registry.

The initial declarations cover three families:

- `branch-update`: a `status-branch-behind` firing is followed when `update` runs on the same recorded branch, surface, and session before the family fires again.
- `red-gate-remedy`: any gate-failure remedy or `done-unchanged-tree-red` firing is followed when `prepare` or `test` runs on the same branch before the next `done`.
- `main-worktree-first`: `ensure-main-worktree-first` is followed when `start` runs on the same recorded surface and session before later dirty-trunk evidence.

The detector derives families and hint membership from `HINTS`. Each delivered firing opens an episode. The declared action resolves it as followed; the contrary boundary resolves it as not followed. Missing correlation, relevant cross-surface evidence, and the end of history leave it censored.

`hint-follow-through` retains its id and advisory routing. It reports raw `fired`, `followed`, `not_followed`, and `censored` counts after three resolved episodes in one family. The detector-level considered count is the largest family count, preventing sparse families from clearing the threshold together. Fully followed evidence remains visible as favorable information; any not-followed episode asks for attention.

This changes the historical branch-update denominator. Three repeated firings contain only two resolved episodes because the final firing is censored at the end of history. Four repeated firings without an update produce three resolved not-followed episodes and one censored episode.

Envelope-less delivered hints use a supplemental process-local accumulator beside the observed-result mailbox. The CLI drains and unions its ids into the event. MCP drains it without attributing CLI output to a tool call. No result envelope is synthesized.

The logbook schema stays unchanged. Missing optional fields censor an episode. `skipped-prepare` remains separate because it measures done-heavy iteration whether or not a hint fired.

## Consequences

- A hint joins measurement by declaring its rule beside its id and text. Registry-driven tests enroll future members.
- Owners can distinguish successful advice, ignored advice, and evidence gaps from raw counts.
- Favorable evidence occupies report space after the threshold. Conservative censoring can delay a finding.
- Invocation boundaries must drain the process-local supplemental accumulator; CLI and MCP entry points are guarded separately.

## Alternatives considered

- **Keep a detector-side table.** Rejected because it duplicates the hint registry and lets new hints escape measurement.
- **Store detector functions on hints.** Rejected because shared data would depend on logbook engine types.
- **Count unresolved firings as not followed.** Rejected because missing fields, history ends, and cross-surface calls are evidence gaps.
- **Create an envelope for the session-start line.** Rejected because supplemental event data records its real output channel.
- **Merge this detector with `skipped-prepare`.** Rejected because one measures delivered advice and the other measures iteration behavior without requiring a hint.
