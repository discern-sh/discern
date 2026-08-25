# ADR 0327: The shipped runtime module graph is a DAG

**Status**: accepted. Applies the structural-guard universe contract in [ADR 0324](0324-structural-guards-declare-git-derived-source-universes.md) to the single-binary architecture in [ADR 0019](0019-single-binary-ts-engine.md).

## Context

The shipped binary is one ECMAScript module graph rooted at [`src/main.ts`](../../../src/main.ts). A runtime import cycle makes initialization order depend on partial module evaluation: a later edit can turn a previously harmless circle into a temporal-dead-zone failure or an undefined value observed during startup. The risk is greatest when a cycle passes through shared process, path, Gate, setup, lifecycle, Desk, or MCP modules because those modules sit beneath much of the program.

The resolved graph is not equivalent to a text scan. Deno applies import resolution, distinguishes code and type dependencies, and reports dynamic imports in the code graph. Its JSON report is external runtime data whose shape can change, so a guard must validate the fields it consumes before treating the report as evidence.

A raw cycle count is also insufficient. One cycle can absorb more modules while the count stays constant, and a failure that prints only a number leaves the maintainer to reconstruct the route by hand.

## Decision

**The repository-local code-dependency graph that Deno resolves from `src/main.ts` contains no strongly connected component.**

[`tests/module_graph.ts`](../../../tests/module_graph.ts) runs `deno info --json`, parses its output to `unknown`, validates every module and dependency field the graph walk consumes, and returns repository-relative modules and code edges. Dynamic imports remain runtime edges. Type-only imports are erased and outside the rule, as are modules reachable only from tests.

[`tests/import_cycle_test.ts`](../../../tests/import_cycle_test.ts) declares the specialized shipped-module source universe under ADR 0324, computes the graph's strongly connected components, and requires zero cycles. There is no exception registry and no numeric ceiling. A failure renders an edge-valid closed route through every member of each component.

Runtime composition follows the same direction. The entry point owns projections of its fully attached command tree and injects them into Gate-capable setup, Desk, MCP, and lifecycle callers. Lower modules do not import `main.ts` to recover entry-point state. Shared path calculations and projection math live in leaf modules when two higher-level modules need them.

## Consequences

- Module initialization has a topological order a reader can trust, and any runtime import that closes a circle fails the Gate with the route that caused it.
- Deno remains the authority on resolution, code-versus-type edges, and dynamic imports; the guard does not maintain a second import parser.
- A Deno report-shape change fails with a bounded, command-named decoder error instead of silently weakening the invariant or crashing on an unchecked cast.
- Some internal APIs carry injected providers or move pure contracts downward to keep dependency direction explicit. That indirection is the cost of keeping the composition root out of lower layers.
- Type-only cycles and test-only graphs remain legal and unmeasured. They do not participate in shipped runtime initialization.
- The guard runs Deno's module analysis during the test stage. The extra process cost buys resolution parity with the built binary's source graph.

## Alternatives considered

- **Allow exact registered cycle edges.** Rejected because no current cycle is necessary, and an exception would preserve the initialization hazard at the most coupled boundary.
- **Measure the number of cycles as a Standard.** Rejected because a zero maximum would detect a breach without naming its route, while any nonzero baseline could hide membership growth behind a steady count. The exact structural assertion is both stricter and more actionable.
- **Replace static back-edges with lazy dynamic imports.** Rejected because Deno reports dynamic code dependencies and the initialization dependency still exists; timing the edge differently is not an architectural cut.
- **Parse import syntax directly in the test.** Rejected because a local parser would have to duplicate Deno's resolution, import-map, dynamic-import, and type-erasure behavior.
