---
title: Canonical sets
description: Locate the membership authorities whose consumers must enroll new members automatically.
order: 65
aliases:
  - canonical registries
  - forcing functions
  - single source of truth
---

# Canonical sets

_Each growing set has one membership authority. Consumers derive membership from it, and guards report omissions._

| Fact                                                      | Authority                                                                                                                                                                                                                            | Consumers & bindings                                                                                                                                                                                                                                            | Fails on drift                                                                                                                                                                                                                                                                                                                                                |
| --------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Tracked effects an ordinary `discern refresh` would apply | [`planTrackedRefresh`](../../../src/engine/tracked_refresh.ts), the ordered [`tracked_refresh_providers.ts`](../../../src/engine/tracked_refresh_providers.ts) reconciler, provider registry, and shared expected-state computations | `status` reports paths; `done` checks before jobs and proof; `accept` checks before fast-forward; `update` enrolls live changes. Plan mode gives the apply writers an in-memory overlay; MCP also reads a `HEAD` overlay to distinguish adoption from deletion. | [`engine_refresh_test.ts`](../../../tests/engine_refresh_test.ts) compares plan/apply and guards MCP cases; [`engine_generated_gitattributes_test.ts`](../../../tests/engine_generated_gitattributes_test.ts) covers attributes and mode drift; [`engine_generated_update_test.ts`](../../../tests/engine_generated_update_test.ts) covers update enrollment. |
| Ordered `done`, `update`, and `accept` operation cores    | [`gatePlanToEngine`](../../../src/engine/gate/plan.ts), [`updatePlanToEngine`](../../../src/engine/worktree/plan.ts), and [`acceptPlanToEngine`](../../../src/engine/worktree/plan.ts)                                               | Dry-run rendering and `doctor`'s execution model consume the same projections; executors implement the corresponding boundary steps. Acceptance expands generic resource teardown with configured commands for the model.                                       | [`execution_model_test.ts`](../../../tests/execution_model_test.ts) compares every label in order and separately requires both `done` tracked-refresh checks, the `accept` landing check, and complete-refresh naming.                                                                                                                                        |

## Adding a tracked refresh writer

Put provider membership in the registry and its transformation in the reconciler. For another artifact class, share one expected-state computation with its writer. Extend `TrackedRefreshArtifactKind`, then prove plan/apply path equality with a changed fixture.

Do not add a filename directly to `done`, `status`, or acceptance. Those surfaces consume the plan; a parallel list recreates the sequencing hole the convergence predicate exists to close ([ADR 0264](../_adr/0264-tracked-refresh-convergence-precedes-landing.md)).
