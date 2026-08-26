---
title: Promise effect ownership
description: Sequence promise-like effects or transfer them to an exact lifecycle boundary with synchronous rejection handling.
order: 59
aliases:
  - detached promises
  - floating promises
  - promise effects
  - detachPromise
---

# Promise effect ownership

_Every asynchronous effect belongs either to the caller's sequence or to a named lifecycle that survives it._

## Consume ordinary effects in sequence

A promise-like expression statement has no visible owner after the statement ends. Production TypeScript therefore awaits, returns, stores, or otherwise structurally consumes the value. `void` is not consumption: it erases the expression result without observing completion or rejection.

The rule follows resolved types rather than call spelling. [`promise_effects.ts`](../../../scripts/promise_effects.ts) constructs one TypeScript project with the strict options and import map in [`deno.json`](../../../deno.json), resolves its external declarations through Deno's live module graph, and asks the checker whether each expression statement can be promise-like. Imported functions, custom `PromiseLike` implementations, unions, overloads, and generic constraints retain their real types. An unresolved `any`, `unknown`, or unconstrained type fails closed instead of becoming a silent exemption ([ADR 0345](../_adr/0345-promise-effects-have-typed-owners.md)).

Deno's lint plugin context has no type service, so this is a separate check-stage task rather than a false syntax-only lint rule. It does not enable `require-await`; function-body style and effect ownership are different questions.

The scan declares the Git-derived `authored-ts` universe: tracked TypeScript source, narrowed to product code and executable repository tooling. A future source root that no current guard names still enrolls. Tests plant rejected expressions and remain consumers of the guard.

## Transfer only to an elected lifecycle

When awaiting would change intentional sequencing, call [`detachPromise`](../../../src/shared/promise_effects.ts). [`DETACHED_PROMISE_BOUNDARIES`](../../../src/shared/promise_effects.ts) is the membership authority. Each row names the exact call site and operation, the component that owns completion after the caller returns, the rejection authority, cancellation or shutdown ownership, and why the caller must continue.

The capability starts a supplied thunk synchronously and installs rejection handling on its normalized promise before returning. Rejection reaches the row's elected synchronous reporter or crash terminator. If that reporter throws, the capability surfaces an uncaught global error; it never creates another unhandled rejection. An unknown id fails before a thunk starts.

Detachment does not imply that work is immortal. Watch and server rows identify the watcher, server, or process boundary that ends them. Abort-time reader cancellation identifies the surrounding drain that remains awaited. Top-level crash rows terminate when crash reporting itself cannot complete. Read the registry for the current exact owner rather than duplicating its population here.

## The guard and ceiling close together

The same task binds registry rows and direct capability calls one-to-one before emitting `detached_promise_boundaries`. Unknown, duplicate, moved, and stale rows fail. IDs must be literal; re-exports, forwarded aliases, asynchronous reporters, reporter-policy drift, and naked `void` fail. A new file joins the type scan through Git without a hand-maintained root list.

The [`detached_promise_boundaries` Standard](../20-quality-gate/standards.md) holds the validated registry population under a falling ceiling. Removing a lifecycle handoff can tighten the ceiling. Adding one requires both the exact metadata and an explicit decision to move the limit.

Start in [`promise_effects_test.ts`](../../../tests/promise_effects_test.ts) when changing the detector or capability. It proves the real import map and future-root enrollment, registry parity, immediate background start, synchronous thunk failure, and the unhandled-rejection sentinel.
