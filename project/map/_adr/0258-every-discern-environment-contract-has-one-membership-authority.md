# ADR 0258: Every `DISCERN_*` environment contract has one membership authority

**Status:** Accepted

## Context

discern uses `DISCERN_*` environment variables at several boundaries: the remote installer, the runtime engine, worktree exports, repository scripts, CI examples, subprocess tests, and shell launchers. Their exact names were repeated where each boundary needed them. No one set could answer which names were current, and a new name had no forcing function that enrolled its readers, writers, documentation, and fixtures together.

A prefix search cannot define the set. The same prefix also names brand constants, canonical registries, and the `DISCERN_METRIC` output protocol. Conversely, some genuine environment carriers live in shell, YAML, TOML, Markdown command examples, or external-process fixtures that cannot import a TypeScript registry. The experimental subset established by [ADR 0254](0254-mcp-preload-remains-an-environment-only-experiment.md) also needs to retain its narrower activation and documentation checks.

## Decision

[`DISCERN_ENVIRONMENT_VARIABLES`](../../../src/shared/environment_variables.ts) is the membership authority for every live, internal, test-only, or intentionally recognized retired `DISCERN_*` environment contract in this repository. Its values are the exact external spellings. The generated `DISCERN_RESOURCE_<NAME>` family has one template member rather than one entry per configured resource. The retired `DISCERN_LIB` member remains registered while `doctor` recognizes it for a targeted migration diagnostic.

TypeScript readers and writers import names from the registry. Existing semantic exports may remain as derived aliases when they give a subsystem a useful type or API, and the experimental registry remains a derived subset so its dedicated guard continues to own activation behavior.

[`tests/environment_variables_enrolment_test.ts`](../../../tests/environment_variables_enrolment_test.ts) covers boundary carriers that cannot import the authority. It scans the Git-derived authored-text universe for environment-shaped process calls, mappings, shell references and assignments, and Deno permission lists. Dated ADRs and private planning notes are historical rather than current contracts. Concrete resource variables collapse to the registered family template. The guard proves both directions: every observed environment use is registered, and every registered member still has a live carrier or a source reference. Synthetic carriers prove that each supported syntax detects a future name.

Reference pages declare their exact documented subsets with registry members. The complete set is enrolled in [`scripts/canonical_sets.ts`](../../../scripts/canonical_sets.ts), so the meta-registry and single-source-of-truth claim guards cover it under [ADR 0176](0176-the-closed-sets-are-a-closed-set.md) and [ADR 0181](0181-an-ssot-claim-must-anchor-a-declared-canonical-set.md). Shell-local implementation variables do not use the uppercase `DISCERN_*` form; that form is reserved for environment contracts at process boundaries.

## Consequences

- A new `DISCERN_*` environment contract is added to one registry. The gate then names every consumer, carrier, or reference subset that still needs enrollment.
- Removing a contract requires removing both its registry member and its last live carrier. Neither side can silently become stale.
- Internal, repository-local, CI-only, and test-only names appear beside public runtime names because membership answers what the repository uses, not what users normally configure.
- Non-TypeScript surfaces retain literal external names, with parity enforced structurally rather than through generated shell and documentation.
- The experimental subset keeps its stricter value and documentation contract while deriving membership from the complete authority.

## Alternatives considered

- **Treat a repository-wide prefix search as the list.** This mixes environment contracts with unrelated constants and protocols, and it provides no importable authority.
- **Keep separate installer, runtime, worktree, and test registries.** That preserves the original membership ambiguity and permits the same name to drift between layers.
- **Generate every shell, workflow, fixture, and documentation carrier.** This would replace small external-boundary literals with a broad generation system. A two-way structural guard provides the same enrollment pressure while keeping those surfaces readable.
