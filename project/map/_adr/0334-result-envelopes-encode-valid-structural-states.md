# ADR 0334: Result envelopes encode valid structural states

**Status**: accepted

## Context

[ADR 0028](0028-result-envelope-and-diagnostics.md) established one `DiscernResult` envelope for every verb. The TypeScript contract later remained a flat interface: `ok` was a boolean, while `error`, `dry_run`, `plan`, and `steps` were independent optional fields. The runtime and published Zod schemas repeated that flat object. They therefore accepted documents that no engine operation could mean, including a success with an error slug, a preview with completed steps, or a result with planned and completed steps.

The structural rules are distinct from the value rules at serialization. Registered hint vocabulary and evidence-backed failure recovery depend on the values inside an otherwise valid result, so types cannot replace those runtime checks.

The producer audit found no result that carries both `plan` and `steps`. It also found 2 boundaries that a stricter contract must preserve. A failed Gate result may carry diagnostics and steps without an `error` slug. A worktree-prune refusal without an interactive terminal may carry a review plan without claiming `dry_run: true`.

The generated result schema is a public same-major contract under [ADR 0208](0208-public-contracts-version-by-schema-major.md). Adding a discriminated state constraint narrows the documents that validate, so the live compatibility policy classifies this change as breaking. The repository has no release tag. Under ADR 0208's pre-release reset rule, no released consumer has pinned the v1 identity yet. The project can correct the current v1 artifact in place.

## Decision

`DiscernResult<TData>` is the intersection of common envelope fields with 2 independent discriminated unions:

- `ok: true` forbids `error`; `ok: false` keeps `error` optional.
- `dry_run: true` forbids completed `steps` and may carry a `plan`.
- a review-plan result may carry `plan` with `dry_run` absent or false and forbids `steps`;
- an applied or observed result may carry `steps`, keeps `dry_run` absent or false, and forbids `plan`.

Forbidden optional fields use `?: never`, so `exactOptionalPropertyTypes` rejects their presence. The exported generic name and the meaning of `data` remain unchanged.

One canonical Zod state schema mirrors those unions. Every strict per-verb object applies it and publishes the same constraint. Generated JSON Schema hoists the constraint as `DiscernResultState`, and generated TypeScript declarations intersect each per-verb type with the corresponding exported state type. Model Context Protocol (MCP) tools advertise the complete per-verb Zod object, including its state validation, rather than advertising the object's unconstrained field inventory.

Serialization keeps the registered-hint and failure-recovery checks. The change removes no structural check there because the boundary did not contain one. The envelope variants change neither field projection nor property order, so engine-produced wire output remains unchanged.

Codegen regenerates the v1 result schema and declarations in place under the pre-release reset rule. There is no compatibility branch that continues to admit contradictory documents. Side projects must refresh copied pre-release schemas and declarations and correct contradictory fixtures.

## Consequences

Verb producers cannot construct the known contradictory states. Consumers narrow success and failure through `ok`, and failure consumers must still account for an absent `error`. Preview, review-plan, and applied consumers can trust that `plan` and `steps` do not coexist.

Runtime validation, MCP output validation, the public JSON Schema, and the generated TypeScript declarations enforce the same structural predicate. A future contract receives the constraint through the result-schema constructor and code generator rather than through a copied per-verb rule.

The published v1 artifact rejects documents that its earlier pre-release form admitted. Side projects that copied the generated schema or declarations before the first release tag need a one-time refresh, and fixtures containing contradictory envelopes need correction. Engine output does not require a wire migration because those documents were never emitted.

## Alternatives considered

Keeping the flat public schema as a compatibility branch would preserve the invalid documents and make generated consumer types less trustworthy than the engine contract. The pre-release reset rule exists for this correction window, so this decision rejects that branch.

Requiring every failed result to carry `error` would misrepresent failed Gate runs, where steps and diagnostics are the failure evidence. Treating every `plan` as a dry run would misrepresent confirmation refusals that return a plan for review. The producer audit rules out both alternatives.

Adding only runtime refinements would reject contradictory bytes but leave TypeScript producers and generated consumers able to construct them. All 4 boundaries enforce the contract.
