# ADR 0384: Evaluate lazy modules outside invocation context

**Status**: accepted.

## Context

The CLI loads verb implementations on demand to keep every process start cheap. Completion also uses async-local context to carry checkout leases, child ownership and progress observers. Module evaluation has process lifetime; those capabilities belong to one invocation.

On Deno 2.9.6, a cold dynamic import inside async-local storage reproduced a context leak into the next test callback, even though the awaiting caller observed its original context on return. The dependency-free reproducer needed only two tests, one storage instance and an imported constant. In discern, artifact identity resolution loaded detached-execution identity code inside checkout exclusion. A later native-lifetime test then inherited that earlier checkout's context and correctly refused a second checkout boundary. Test order and an already-evaluated dependency could hide the defect.

## Decision

All shipped lazy imports cross `loadModule`. Its module captures the process context before discern installs invocation state. Runtime context owners import the storage constructor from this same module, so their initialization depends on the baseline capture. The loader evaluates code in that baseline, while the awaiting continuation keeps the calling invocation's context on fulfillment or rejection.

The import remains lazy and its module specifier remains visible to Deno's graph and compiler. Module initialization receives no invocation leases, child receipts or progress sink. Functions exported by a loaded module receive the caller's ordinary context when subsequently invoked. Lock ownership, exclusion, cancellation and awaited cleanup retain their existing rules.

A Git-derived structural guard enrolls runtime containers at any depth, follows loader aliases and rejects unwrapped imports, shadowed lookalikes and direct context-primitive imports outside the authority. A fresh-process regression verifies cold and warm imports, concurrent callers, rejected evaluation, and the next unrelated callback. It runs as a canary so a warm full-suite graph cannot hide the failure.

## Consequences

- Lazy startup and the acyclic runtime graph remain intact.
- Every new runtime import and context owner must use the shared boundary.
- Module initialization cannot depend on the invocation that first happens to load it. Such work belongs in an exported function called by that invocation.
- The baseline is process context, not a reset of unrelated third-party state. Discern's context-owner dependency is enforced; downstream callers still own their own lifetimes.

## Alternatives considered

- Eagerly loading every verb would avoid cold imports while taxing every CLI subprocess with the complete implementation graph.
- Warming one test or statically importing only detached identity would hide this instance while leaving other invocation-time imports exposed.
- Resetting lock context between tests or ignoring nested-checkout refusals would bypass the capability boundary instead of preserving it.

## Reproduction

Run `discern queue -- deno task test tests/module_loading_test.ts tests/module_loading_guard_test.ts tests/completion_native_lifetime_test.ts --shuffle=415325478`. The first test starts its own fresh runtime and fixes callback order; it does not depend on the outer shuffle. The native suite exercises the original detached-job path without altered assertions. Removing the loader's context isolation makes the cold-process regression fail.
