---
aliases:
  - ambient state
  - process environment
  - cwd injection
  - host boundary
---

# Ambient process state

_Where authored code may consult the host process, and how deeper code receives those values._

Environment variables and the current working directory are runtime inputs. Resolve them at a composition root and pass the resulting string or setting into deeper code. A default parameter such as `cwd: string = Deno.cwd()` is also a visible injection seam: production callers retain host behavior while tests and embeddings can pass a value directly ([ADR 0336](../_adr/0336-ambient-process-state-resolves-at-boundaries.md)).

Do not thread an environment-reader interface through several layers merely to move a read. If a module genuinely adapts the host — an executable entry point, command adapter, server, standalone script, or integration harness — register the module in [`AMBIENT_READ_BOUNDARIES`](../../../scripts/ambient_state_lint.ts) with a reason that names that role. Feature-toggle modules retain their host-facing contract through the same registry.

Process mutation is a separate and stricter boundary. `Deno.env.set` and `Deno.env.delete` require an exact entry in `AMBIENT_MUTATION_BOUNDARIES`, including the enclosing function and operation. Prefer an explicit value seam; the registry is empty while no unavoidable mutation exists. A default parameter never exempts mutation.

## One authority for the trunk branch

[`integrationBranch`](../../../src/engine/worktree/git.ts) owns the `DISCERN_TRUNK` precedence contract and is its only environment reader. Call it at the boundary or pass its resolved branch name. Do not reproduce the environment lookup in a consumer.

## Enforcement and recovery

The ambient-state plugin in [`ambient_state_lint.ts`](../../../scripts/ambient_state_lint.ts) runs under `deno lint`. [`ambient_state_lint_test.ts`](../../../tests/ambient_state_lint_test.ts) applies it to the full Git-derived `authored-deno` universe, rejects stale or malformed registrations, and checks the sole trunk reader. The `ambient_read_boundaries` and `ambient_mutation_boundaries` Standards in [`discern.toml`](../../../discern.toml) hold both exception counts at down-only limits.

When the rule finds a read, first move resolution to the nearest composition root and pass a value. A direct default is appropriate when the function itself is the public seam. Register a module only when it owns a genuine host interaction and further threading would conceal that boundary. When the mutation rule fires, replace the mutation with an explicit input unless the process-global consequence is fundamental and can be stated precisely in an exact registration.
