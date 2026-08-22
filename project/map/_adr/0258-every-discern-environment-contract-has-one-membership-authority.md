# ADR 0258: Every `DISCERN_*` environment contract has one membership authority

**Status**: accepted

## Context

discern uses `DISCERN_*` environment variables at several boundaries: the remote installer, the runtime engine, worktree exports, repository scripts, CI examples, subprocess tests, and shell launchers. Their exact names were repeated where each boundary needed them. No one set could answer which names were current, and a new name had no forcing function that enrolled its readers, writers, documentation, and fixtures together.

The names also serve different audiences. Installer inputs, runtime overrides, Project Script exports, worktree values, and experimental controls are public contracts. Crash-path injection, repository-development overrides, process markers, and test coordination values are implementation details. Comments grouped the original name list by rough purpose, while hand-authored reference tables selected their own public subsets and descriptions. That left purpose, visibility, and public copy outside the membership authority.

A prefix search cannot define the set. The same prefix also names brand constants, canonical registries, and the `DISCERN_METRIC` output protocol. Conversely, some genuine environment carriers live in shell, YAML, TOML, Markdown command examples, or external-process fixtures that cannot import a TypeScript registry. The experimental subset established by [ADR 0254](0254-mcp-preload-remains-an-environment-only-experiment.md) also needs to retain its narrower activation and documentation checks.

## Decision

[`DISCERN_ENVIRONMENT_VARIABLE_DEFINITIONS`](../../../src/shared/environment_variables.ts) is the authority for every live, internal, test-only, or intentionally recognized retired `DISCERN_*` environment contract in this repository. Each semantic key owns the exact external spelling, one purpose group, its live or retired lifecycle, and a discriminated documentation policy. A public definition requires its short description. An internal definition requires the reason it is withheld. Visibility and lifecycle remain separate decisions, so an experimental control can be public without becoming a stable config setting.

The generated `DISCERN_RESOURCE_<NAME>` family has one template member rather than one entry per configured resource. The retired `DISCERN_LIB` member remains registered while `doctor` recognizes it for a targeted migration diagnostic. Shell-local implementation variables do not use the uppercase `DISCERN_*` form; that form is reserved for environment contracts at process boundaries.

TypeScript readers and writers import the derived name-only [`DISCERN_ENVIRONMENT_VARIABLES`](../../../src/shared/environment_variables.ts) compatibility API. Group subsets derive with the same semantic keys; the experimental registry therefore enrolls every definition in the Experimental features group while its dedicated module and guard continue to own exact activation behavior.

[`tests/environment_variables_enrolment_test.ts`](../../../tests/environment_variables_enrolment_test.ts) covers boundary carriers that cannot import the authority. It scans the Git-derived authored-text universe for environment-shaped process calls, mappings, shell references and assignments, and Deno permission lists. Dated ADRs and private planning notes are historical rather than current contracts. Concrete resource variables collapse to the registered family template. The guard proves both directions: every observed environment use is registered, and every registered member still has a live carrier or a source reference. Synthetic carriers prove that each supported syntax detects a future name.

[`scripts/environment_variable_reference.ts`](../../../scripts/environment_variable_reference.ts) renders the ordered public groups into [`environment-variables.md`](../70-reference/environment-variables.md). `scripts/codegen.ts` owns the write, and the generated-artifact declaration reruns it in the gate. The renderer filters only on each definition's documentation policy. It does not carry a second public-name list.

[`tests/environment_variables_codegen_test.ts`](../../../tests/environment_variables_codegen_test.ts) checks definition and group structure, committed-page currency, one table row per public definition, and absence of internal definitions. Synthetic definitions prove that a future public member renders and a future internal member stays hidden. Its publication-boundary guard discovers the map through the shared document model and rejects an internal registered name in any published tier, so a new public section enrolls without changing this guard.

The complete set is enrolled in [`scripts/canonical_sets.ts`](../../../scripts/canonical_sets.ts), together with both guards and the generated artifact. The meta-registry and single-source-of-truth claim guards cover it under [ADR 0176](0176-the-closed-sets-are-a-closed-set.md) and [ADR 0181](0181-an-ssot-claim-must-anchor-a-declared-canonical-set.md).

## Consequences

- A new `DISCERN_*` environment contract is added to one definitions object. Its name-only APIs, public reference membership, search alias, and registry atlas entry derive from that edit.
- Removing a contract requires removing both its registry member and its last live carrier. Neither side can silently become stale.
- Internal, repository-local, and test-only names remain in the code authority while the public renderer omits them. A hidden name in a published page fails the gate.
- Non-TypeScript runtime surfaces retain literal external names, with parity enforced structurally rather than through generated shell and workflow files.
- The experimental subset keeps its exact-value activation contract while its short user-facing description appears in the generated reference with the other public controls.
- Public descriptions now live beside the contracts they describe. Longer contextual guides link to the generated reference or explain behavior without maintaining another inventory.

## Alternatives considered

- **Treat a repository-wide prefix search as the list.** This mixes environment contracts with unrelated constants and protocols, and it provides no importable authority.
- **Keep separate installer, runtime, worktree, and test registries.** That preserves the original membership ambiguity and permits the same name to drift between layers.
- **Keep a separate public registry or hand-authored reference table.** Either duplicates membership and requires every future variable to be classified in a second place. Publication is data on the complete definition instead.
- **Generate every shell, workflow, and fixture carrier.** This would replace small external-boundary literals with a broad generation system. A two-way structural guard provides the same enrollment pressure while keeping those surfaces readable.
