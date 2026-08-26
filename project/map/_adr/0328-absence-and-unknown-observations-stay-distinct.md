# ADR 0328: Absence and unknown observations stay distinct

> **Amendment ([ADR 0341](0341-deliberate-error-discard-is-a-named-side-effect-boundary.md)):** [`fs_presence.ts`](../../../src/shared/fs_presence.ts) now owns strict presence only. Deliberate suppression moved to [`BEST_EFFORT_BOUNDARIES`](../../../src/shared/best_effort.ts), whose capabilities accept side effects and return only `void`; exact direct syntax exceptions consume the same authority. The Git-count, causal-chain, and strict-presence decisions below remain in force.

**Status**: accepted. Applies the structural-guard universe in [ADR 0324](0324-structural-guards-declare-git-derived-source-universes.md), preserves the apply-time authority boundary in [ADR 0027](0027-plan-apply-engine-execution.md), and makes a pre-release correction to the status field types named in [ADR 0222](0222-frozen-contracts-complete-the-canon.md) under [ADR 0208](0208-public-contracts-version-by-schema-major.md)'s pre-tag rule.

## Context

Several workflows need to ask whether an optional path exists or read it only when present. Local helpers had independently implemented that question by catching every filesystem error and returning `false`, `undefined`, or an empty value. That made an absent path indistinguishable from permission denial, an invalid path component, or another operating-system failure. Root discovery was the highest-impact example: an unreadable candidate `discern.toml` looked like no project, so discovery could walk past the real project and report the wrong recovery.

Some filesystem observations are genuinely advisory. A failed cache read, cleanup probe, activity timestamp, or diagnostic detail must not change the primary operation's outcome. Treating all optional reads as strict would make those secondary observations authoritative; retaining anonymous catch-all helpers would keep their loss invisible.

Git counts had the same information-loss shape. Failed commands and malformed output were coerced to `0`, even though zero is a factual claim about the commit graph. Status, update summaries, containment offers, and readiness decisions then could not tell a verified zero from a missing observation. Existing `null` and omitted states already mean a missing comparison target or unavailable containing object, so reusing them would collapse another distinct condition.

Finally, several catch blocks incorporated a caught error into a replacement error's message without retaining the original value. The message stayed readable, but programmatic inspection and stack-aware diagnostics lost the causal chain.

## Decision

**Absence, deliberate suppression, and failed observation are separate states.**

[`src/shared/fs_presence.ts`](../../../src/shared/fs_presence.ts) owns local filesystem presence and read-if-present semantics. Its ordinary helpers catch only `Deno.errors.NotFound`; every other error propagates unchanged. A non-critical observation may suppress other errors only through `bestEffortFs`, whose call site must state both a non-empty reason and the fallback consequence. The same named boundary accepts synchronous and asynchronous reads. There is no ambient best-effort mode.

[`tests/fs_presence_enrolment_test.ts`](../../../tests/fs_presence_enrolment_test.ts) scans the declared `authored-deno` universe outside the capability for raw filesystem reads whose catch path returns an absence sentinel, skips the item, or suppresses a rejected promise. Its planted controls use unrelated helper names so naming cannot evade enrollment. Inline fixture behavior may exercise failures directly; reusable test helpers follow the capability.

Numeric Git facts use [`GitCount`](../../../src/shared/git_count.ts): a non-negative safe integer or the literal `"unknown"`. Empty output, command failure, malformed or non-canonical integers, non-finite values, and unsafe integers produce `"unknown"`; a parsed zero remains `0`. `null` continues to mean that no comparison target exists, and omitted fields continue to mean that the containing observation is unavailable. Status, await, result schemas, generated consumer contracts, and human renderers carry those distinctions.

An unknown advisory count never authorizes an effect. Mutating workflows decide from fresh ancestry, identity, cleanliness, or existence preconditions at the apply boundary and fail closed when those reads cannot establish the predicate. Counts describe the outcome; they do not substitute for the precondition. Update repeats ancestry inside both the default-trunk and explicit-`--from` apply paths.

When a catch constructs an error from its caught value, the replacement includes `{ cause: caughtValue }`. [`scripts/error_cause_lint.ts`](../../../scripts/error_cause_lint.ts) enforces that syntax-aware rule. Custom error constructors accept and forward `ErrorOptions`. The initial authored-code sweep is fixed at zero rather than retained behind a Standard.

The migration reader's optional `.claude/settings.json` follows the same absence rule. Once the file is present, its parsed root must be a non-array object before settings merge consumes it; malformed roots are failures, not empty settings.

## Consequences

- “No project” and “file absent” now assert real absence. Permission and other operating-system failures reach the caller with their original identity.
- Best-effort behavior remains available, but review can see why losing the observation is safe and exactly what value replaces it.
- A status consumer must accept `"unknown"` alongside numeric ahead and behind values. Because no release tag exists, the live version-1 result publication is corrected in place under ADR 0208's pre-tag rule; side projects still need an explicit migration.
- Readiness and containment may become unavailable when Git cannot establish a count. That loss of convenience is preferable to a false clean, empty, current, or contained claim.
- Error messages can retain their concise contextual wording while debuggers and callers traverse `Error.cause` to the original failure.
- New optional filesystem operations belong in the shared capability. A genuinely advisory call must make its suppression policy locally visible.

## Alternatives considered

- **Catch every filesystem error and improve the message later.** Rejected because the false absence has already selected the wrong workflow and recovery before a later layer can explain it.
- **Make every optional observation strict.** Rejected because diagnostics, caches, cleanup, and activity hints are intentionally secondary. A named best-effort boundary preserves that product behavior without making it the default.
- **Use `0`, `null`, or omission for failed Git counts.** Rejected because `0` is factual, `null` already means no comparison target, and omission belongs to a missing containing observation. A distinct literal preserves all three meanings in JSON and TypeScript.
- **Fail every read-only command when a Git count is unavailable.** Rejected because an advisory view can still report other trustworthy facts. Effects fail closed through their own fresh preconditions instead.
- **Adopt a falling ceiling for missing causes.** Rejected because the measured 24-site blast radius was tractable; carrying legacy violations would make causal-chain loss an accepted baseline.
