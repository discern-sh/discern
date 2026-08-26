# ADR 0341: Deliberate error discard is a named side-effect boundary

**Status**: accepted. Narrows the suppression clause in [ADR 0328](0328-absence-and-unknown-observations-stay-distinct.md), applies the canonical-set forcing function in [ADR 0051](0051-canonical-set-parity.md) to deliberate error discard, and holds its population under the growth-proof Standard policy in [ADR 0161](0161-growth-proof-standards-and-breach-escalation.md).

## Context

The causal-chain rule preserves an error when code replaces it and throws again, but it says nothing about an error that disappears. A catch statement can swallow synchronously, while a promise rejection handler can do the same without catch syntax. Empty blocks are only the obvious form: returning `undefined`, an empty value, or another fallback also converts failure into an apparently ordinary result.

The shared filesystem helper previously allowed a caller to state a free-form suppression reason and receive `T | undefined`. That combined two different policies. Optional data reads need an explicit presence and validation path; best-effort cleanup, reporting, and advisory writes need a secondary side effect whose failure cannot replace the primary outcome. A value-producing suppression capability makes those uses indistinguishable in the type system and lets a new discard appear without joining the enumerated population.

A single wrapper call count would not close that hole. One wrapper could accept arbitrary callbacks or dynamic reasons while the number of real discard sites grew behind it. Reporter failure adds another edge: reporting a secondary failure must not create an unhandled rejection or replace an already-active primary error.

## Decision

[`BEST_EFFORT_BOUNDARIES`](../../../src/shared/best_effort.ts) is the membership authority for every deliberate production error discard. Each stable id owns the exact path, enclosing function, operation, synchronous or asynchronous shape, observability policy, and reason.

`bestEffort` and `bestEffortSync` accept side effects only and return `Promise<void>` and `void`. They validate the boundary before running the effect. An effect failure either reaches the reporter authority declared by the registry entry or is explicitly classified as unobservable. Effect and reporter failures settle inside a validated capability invocation, so they cannot create an unhandled rejection and secondary cleanup cannot replace a primary error.

The capability is not a data-access path. Filesystem presence remains strict in [`fs_presence.ts`](../../../src/shared/fs_presence.ts), runtime data validates at its decoder, and neither failure becomes an absent value through best effort.

Syntax that genuinely cannot call the capability may remain direct only with one exact registry marker. Module-wide exclusions do not exist. The normal Deno [`no-silent-catch`](../../../scripts/silent_catch_lint.ts) rule checks the Git-derived authored production universe for empty and comment-only catch blocks, discard-only and absence-returning handlers, and promise rejection handlers in `.catch` or the rejection arm of `.then`. Promise detachment is a separate policy.

[`best_effort_guard.ts`](../../../tests/best_effort_guard.ts) binds registry entries, capability calls, and direct markers in both directions. It rejects unknown, duplicate, moved, and stale entries, dynamic ids, reporter-policy drift, and generic wrappers that forward arbitrary callbacks. The `silent_error_boundaries` census measures that validated authority population, not one syntax form or the wrapper definition, and a falling Standard prevents it from growing without an explicit limit decision.

## Consequences

- Every intentional disappearance is reviewable as a named policy decision, and future production roots join the structural scan automatically.
- A failed optional read can no longer masquerade as absence through the sanctioned capability. Callers must choose strict presence, validation, a structured failure result, or a named side-effect discard.
- Cleanup and advisory failures cannot cause unhandled rejections or erase a primary failure. An unobservable entry still loses information by design, but the exact loss and reason are visible in the authority.
- The registry is substantial metadata to maintain. That cost is intentional: adding or moving a boundary requires updating its exact owner and explaining why the loss is safe.
- The lint rule recognizes structural swallowing rather than proving every possible flow of JavaScript values. Planted synchronous, promise, alias, async, and nested-cleanup forms define its enforced class; the bidirectional census closes the wrapper and exception paths.
- The falling ceiling may need an owner decision when a product feature truly requires another discard. Removing a boundary permanently lowers the available population once the Standard is pinned.

## Alternatives considered

- **Keep a generic `bestEffort<T>` with a free-form reason and fallback.** Rejected because it makes failure look like ordinary data and gives future sites no stable membership to enroll.
- **Lint only empty catch statements.** Rejected because promise handlers and value-returning catches swallow the same error through different syntax.
- **Count wrapper definitions or raw catches.** Rejected because a central wrapper or direct exception could hide unlimited new discard sites while the metric stayed flat.
- **Make every secondary failure fatal.** Rejected because cleanup, diagnostic, and advisory effects sometimes must preserve a primary outcome. Their loss is permitted only at the named boundary.
