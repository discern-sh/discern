# ADR 0336: Ambient process state resolves at host boundaries

**Status**: accepted. Extends the env/cwd injection discipline in [ADR 0068](0068-parallel-safe-tests-env-cwd-injection.md) from parallel-safe tests to authored production and script code.

## Context

Functions deep in the Engine and installer still read `Deno.env` or `Deno.cwd()` directly. Their signatures hid inputs that changed behavior, so unit tests and embeddings sometimes had to reproduce host state instead of supplying ordinary values. The same configuration fact could also acquire several readers: `DISCERN_TRUNK` was resolved in eight modules even though `integrationBranch` already owned its precedence contract.

Not every ambient read is misplaced. Executable entry points, command adapters, the Model Context Protocol server, standalone scripts, and integration-test boundaries genuinely compose the current host. Forcing every such read through several layers of reader interfaces would make ownership less legible. Default-parameter reads also provide an explicit, injectable seam without burdening ordinary callers.

The landing refresh path exposed the separate risk of mutation. It temporarily changed a process environment variable to redirect template lookup, called into refresh, and restored the value afterward. That round trip could leak across concurrent work even though the final process state was restored.

## Decision

Authored Deno code reads process environment and cwd only in one of two places:

- a default-parameter expression, where a caller can replace the value directly; or
- a module listed in `AMBIENT_READ_BOUNDARIES`, with a specific reason identifying its host-facing role.

Core code receives resolved values. Boundary callers prefer strings and settings over passing an `EnvReader` through multiple layers. When extra parameter plumbing would be disproportionate to a genuine host adapter, the whole module is a visible registered boundary instead.

`integrationBranch` is the only function that reads `DISCERN_TRUNK`. Other modules call it or receive its resolved branch name, so the precedence contract has one authority.

Process-environment mutation is not a read exception. `Deno.env.set` and `Deno.env.delete` require an exact `AMBIENT_MUTATION_BOUNDARIES` entry keyed by module, enclosing function, and operation. The landing refresh instead passes its remapped templates directory as a value, leaving the mutation registry empty.

The `discern-ambient-state` Deno lint plugin enforces both rules during normal lint. A structural test applies the same plugin to the Git-derived `authored-deno` universe, checks registry reasons and stale entries, and proves the trunk-reader authority. Two down-only Standards hold the read-boundary and mutation-boundary counts, so neither exception set can grow without an owner decision.

## Consequences

Behavior below a composition root follows from visible arguments, and tests or future embeddings can supply env and cwd values without changing the host process. Trunk resolution cannot drift between call sites. Refresh no longer creates a process-global concurrency window.

The read registry records legitimate host coupling rather than pretending it does not exist. Its module-level granularity is intentionally coarser than the exact mutation registry; a new read in an already registered host module therefore relies on review plus the module's stated boundary. Staleness checks remove entries whose last ambient read disappears, and the falling ceiling prevents adding another boundary casually.

Default parameters may still consult the host when a caller omits the argument. This preserves current command behavior while making the dependency injectable. The decision changes plumbing, not configuration precedence, environment-variable meaning, or command results.

## Alternatives considered

Passing an environment-reader interface through every call chain was rejected because it turns one hidden read into widespread host-shaped plumbing. Resolving a value at the composition root gives deeper code a smaller and clearer contract.

Forbidding all direct reads outside one executable file was rejected because commands, standalone scripts, servers, and integration-test adapters are independent host boundaries. Moving their reads into forwarding helpers would satisfy a textual rule while obscuring the real ownership.

Keeping the save/set/restore sequence in the landing refresh path and registering it was rejected because restoration does not make process mutation safe under concurrency. The existing templates-directory seam carries the intended value without global state.

A textual repository scan was rejected in favor of a syntax-aware lint rule. The lint abstract syntax tree distinguishes default-parameter position, static property access, and exact mutations without false matches in comments or strings.
