# ADR 0297: Checkpoint modes are the closed stop/advise pair

**Status**: accepted; completes the mode half of [ADR 0293](0293-checkpoint-declarations-interlock-the-gate.md)

## Context

A checkpoint needs exactly one operational question answered: when its trigger fires, may the gate proceed without a recorded conclusion? Review systems usually grow severity ladders (info/warn/error/blocker) whose middle rungs mean nothing operationally — a "warning" neither blocks nor disappears, so it trains readers to scroll past all of it. discern already has an advisory channel with a hard charter (advisories inform; no advisory reader gates a command), and scarcity is a design value for checkpoints: the failure mode is twenty active interlocks, not too few.

## Decision

**Two modes, closed: `stop` (the default) and `advise`.**

- `stop`: `discern done` refuses before any gate job until the agent records a met or unmet conclusion for the current subject. The default, because a checkpoint worth configuring is worth answering — and a declared-unmet answer plus an owner variance is always available, so `stop` never traps a legitimate exception.
- `advise`: the criterion and its matched evidence are delivered through the existing advisory channels and never require a declaration; firings are still recorded for economics. This is the home for heuristic triggers (delta shapes, name similarity) whose false positives would make a hard interlock corrosive.
- The pair is a closed vocabulary (`CHECKPOINT_MODES`), carried by the config schema's enum and every consumer through the one constant, so a third mode is a deliberate schema change, not a drive-by string.
- Scarcity stays a design value the modes serve: batching, fire-once episodes, `advise` for heuristics, and measured economics exist so `stop` can stay rare and meaningful.

## Consequences

- Every fired checkpoint has an unambiguous operational meaning: either the gate waits for a recorded judgment, or nobody is blocked and the criterion arrives as counsel.
- Tuning pressure has one honest lever: a too-noisy `stop` checkpoint becomes `advise` or narrows its trigger — there is no middle severity to hide in.
- Hygiene signals (dead, noisy, frequently varied checkpoints) come from observed economics later in the programme, not from more modes now.

## Alternatives considered

- **A severity ladder.** Rejected: only the boundary between "blocks" and "does not block" is operational; every additional rung is prose wearing a uniform.
- **`advise` as the default.** Rejected: an ignorable default makes configuring a checkpoint a wish, not a decision, and the unmet-plus-variance path already gives `stop` a humane escape.
- **A per-checkpoint "once per effort" mode.** Rejected as a mode: fire-once is what episodes already provide for an unchanged subject; encoding it as a mode would blur state with policy.
