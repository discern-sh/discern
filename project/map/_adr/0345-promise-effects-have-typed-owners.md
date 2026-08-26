# ADR 0345: Promise effects have typed owners

**Status**: accepted. Separates promise sequencing from deliberate error discard in [ADR 0341](0341-deliberate-error-discard-is-a-named-side-effect-boundary.md), applies the Git-derived structural universe from [ADR 0324](0324-structural-guards-declare-git-derived-source-universes.md), and holds deliberate detachment under the growth-proof Standard policy in [ADR 0161](0161-growth-proof-standards-and-breach-escalation.md).

## Context

A promise-like value used as a bare expression can escape the caller's sequence. Its work continues after the statement, and its rejection may surface later with neither the original operation nor its lifecycle owner visible. `void promiseEffect()` changes only the expression's apparent value; it neither owns completion nor installs rejection handling.

Syntax cannot identify the class. A call named `run`, `write`, or `close` may return `void`, `Promise<T>`, an imported custom `PromiseLike<T>`, a union, an overload, or a generic type. Deno's lint plugin `RuleContext` exposes syntax and source text but no TypeScript type service. A syntax-only lint rule would therefore either miss imported and inferred members or reject synchronous calls with similar spelling.

Intentional concurrency also exists. Watcher callbacks delayed to coalesce changes, event listeners, response-triggered shutdown, and abort-time drain cancellation cannot always await without changing sequencing. Treating every such site as a naked `void` leaves no stable membership, rejection policy, or shutdown owner to review.

## Decision

Promise-effect consumption is enforced by a separate type-aware check in [`promise_effects.ts`](../../../scripts/promise_effects.ts), not by a Deno lint plugin and not by `require-await`. The check builds one compiler project with the repository's strict options and live Deno import graph, then scans the Git-derived authored production TypeScript universe. A promise-like expression statement must be awaited, returned, stored, passed into another structural consumer, or transferred through the deliberate-detachment capability. `void` is unwrapped and remains a failure. Any or unknown types that prevent a reliable decision fail closed.

[`DETACHED_PROMISE_BOUNDARIES`](../../../src/shared/promise_effects.ts) is the membership authority for intentional transfer beyond the caller. Each stable id records the exact path, enclosing function, operation, lifecycle owner, synchronous rejection authority, cancellation or shutdown owner, and reason awaiting would be incorrect. `detachPromise` accepts only a registered id plus a promise or thunk and a synchronous reporter. It attaches rejection handling before returning. A reporter throw is surfaced as a global error rather than becoming a second unhandled rejection.

The structural half of the check binds calls and entries in both directions. It rejects unknown, duplicate, moved, and stale entries, dynamic ids, re-exports, forwarded capability aliases, and reporter-policy drift before emitting `detached_promise_boundaries`. The population is a falling Standard.

## Consequences

- Imported promises, custom `PromiseLike` values, unions, overloads, and constrained generics receive the same ownership rule as local `Promise` values.
- Every intentional detachment states who owns completion, rejection, and shutdown after the caller returns. Adding a new lifecycle boundary requires an exact registry row and an owner decision if it raises the Standard.
- Ordinary async effects remain visibly sequenced through `await`, `return`, storage, or another structural consumer. Naked `void` is never an exemption.
- The check has compiler-program cost and depends on Deno's resolved graph and installed cache. Its task is slower than a syntax lint, so the Gate runs it as a separate bounded check with declared Standard inputs.
- Structural consumption is intentional but not a whole-program proof that a downstream consumer behaves correctly. The rule establishes ownership transfer at the call site; the receiving capability's own contract remains responsible for the value.
- The detachment reporter must be synchronous. Reporter failures become uncaught global errors so the capability never turns one rejected effect into another floating rejection.

## Alternatives considered

- **Add a syntax-only `no-floating-promise` lint rule.** Rejected because the installed lint API cannot resolve return types and would certify a false invariant.
- **Treat `void` as deliberate detachment.** Rejected because it erases a value without installing rejection handling or naming a lifecycle owner.
- **Require every promise expression to be awaited.** Rejected because synchronous callbacks and background lifecycles sometimes must hand work to a longer-lived owner without blocking their own sequence.
- **Enable `require-await`.** Rejected because whether an `async` function contains an `await` is unrelated to whether a returned promise effect has an owner.
- **Keep a free-form fire-and-forget helper.** Rejected because one wrapper could hide an unbounded population and could not prove path, lifecycle, rejection, and shutdown parity.
