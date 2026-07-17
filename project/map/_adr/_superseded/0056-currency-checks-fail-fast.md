# ADR 0056: Run the generated-artifact currency checks as fail-fast preconditions too

> **Consolidated into [ADR 0050](../0050-merge-check-fail-fast.md).** The guidance/skills currency checks join the merge check as fail-fast preconditions. Kept for history.

**Status**: accepted. Extends [ADR 0050](../0050-merge-check-fail-fast.md) (the front-loaded merge check) to the currency checks of [ADR 0034](../0034-agents-md-untracked-currency-check.md).

## Context

[ADR 0050](../0050-merge-check-fail-fast.md) moved the merge check to the front of `finish`, fail-fast. The gate rejects a branch behind main before the slow fix/build/check∥test sweep, because the forced re-run discards that work anyway. The argument turned on one fact: the merge verdict is invariant across a gate run, so checking first gives the same answer as checking last.

The generated-artifact currency checks ([ADR 0034](../0034-agents-md-untracked-currency-check.md)) sat in the other place: **last**, after the scope gates. A stale `CLAUDE.md` or a drifted `.claude/skills/` blocked the gate only at the end — so an agent paid the full fix/build/check∥test cost, then read "run `discern refresh` and re-run." That re-run discards the gate's whole result, exactly the waste ADR 0050 removed for the merge check. `discern integrate` ([ADR 0055](../0055-update-verb.md)) now bundles the refresh into a merge, but a hand-edit or a forgotten refresh still strands drift, and the gate still surfaced it last.

## Decision

**Move the guidance and skills currency checks to fail-fast preconditions, beside the merge check** — they run first, before fix/build/check∥test/scope-gates. When a generated file is stale, the gate sets `failed_stage` to `guidance` or `skills` and skips every downstream stage. Those stages then serialize as `skipped` — the same shape ADR 0050 gives a behind branch. The `--dry-run` plan lists the currency gates right after the merge check, matching the run.

The verdict is invariant across a gate run, for the same kind of reason the merge check's is. The gate never runs `discern refresh`. Its fix stage formats SOURCE code — never the guidance sources, the config, or the gitignored generated artifacts the currency checks read. So the inputs and the comparison target hold still across the run, and checking first returns the same answer as checking last. discern's own formatter config excludes those paths. The convention — a project's formatter leaves its gitignored build artifacts alone — makes the same hold elsewhere. The lone exception — a project whose formatter rewrites its own guidance source — is already covered downstream. The fix-stage strand check ([ADR 0047](../0047-fix-stage-strand-detection.md)) flags fixer output left on a committed-clean file. That strand check **stays** after the fix stage. Unlike the currency checks, it reads a snapshot the fix stage produces, so it cannot move earlier.

## Consequences

- **Stale drift surfaces in seconds, not minutes.** A stale generated file stops the gate before any capability runs — the win ADR 0050 brought to the merge check, now for the artifacts integrate exists to keep current.
- **The contract holds.** `failed_stage` still reads `guidance`/`skills`, the same diagnostic (the diff + the `discern refresh` reproduce command) still rides in the result, and `MISSING` still does not block (only `STALE` does, per ADR 0034). Only the moment of the check moves.
- **The plan and the run still agree.** One projection (`gatePlanToEngine`) and the executor both order the preconditions the same way, so `--dry-run` matches a real run.
- **A regression guard pins it.** An engine test wires a capability, stales a generated file, and asserts `failed_stage = "guidance"` with every step `skipped` — so a later change cannot drop the check back to the end.

## Alternatives considered

- **Leave the currency checks last.** Rejected — the status quo that burns the slow stage on a tree the agent must refresh and re-run regardless, the same waste ADR 0050 already removed for the merge check.
- **Run them right after the fix stage** (fast, but post-fix). Rejected as unnecessary: the verdict does not depend on the fix stage (it touches none of the checks' inputs), so there is no reason to wait for it. The strand check, which does depend on the fix stage, stays after it.
