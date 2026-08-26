# Scope: 20-quality-gate

Read [`documenter-agent-brief.md`](../documenter-agent-brief.md) first.

## What this subtree documents

This subtree documents the public Gate workflow: fixing a failed run, the work `discern done` coordinates, Standards, Proof, continuous improvement, and co-change advice. Engine contract implementation belongs in `50-engine-internals`; public command and Model Context Protocol (MCP) contracts belong in `70-reference`.

## Files to produce

| File                      | Topic                                                                                      |
| ------------------------- | ------------------------------------------------------------------------------------------ |
| `README.md`               | Public-facing 200–350-word overview, led by the route from a red Gate to its fix.          |
| `when-the-gate-fails.md`  | Troubleshooting page for diagnostics and common failure classes; `order: 10`.              |
| `validation-findings.md`  | Guide to the persisted validation findings emitted after failed and successful runs.       |
| `standards.md`            | Guide to metric floors, ceilings, measurement, replay, pinning, and failures; `order: 20`. |
| `practice-stats.md`       | Guide to measuring repeated development practices from the Logbook.                        |
| `checkpoints.md`          | Guide to deterministic triggers and judgment-bearing checkpoint answers.                   |
| `checkpoint-recipes.md`   | Task recipes for placing and tuning common checkpoint boundaries.                          |
| `the-proof.md`            | Guide to review Proof and the exact-tree identity it records; `order: 30`.                 |
| `proof-notes.md`          | Guide to local Proof notes, opt-in fetch transport, and publication; `order: 40`.          |
| `strand-detection.md`     | Concept page for tracked output left by a Gate stage; `order: 50`.                         |
| `ci.md`                   | Guide to enforcing `discern done` with GitHub Actions; `order: 60`.                        |
| `improvement.md`          | Concept and command guide for ranked continuous-improvement findings; `order: 70`.         |
| `coupling.md`             | Concept and command guide for coupling; `order: 80`.                                       |
| `patterns.md`             | Guide to the advisory practice-pattern report; `order: 90`.                                |
| `pattern-investigations.md` | Guide to collecting evidence for one reported practice pattern.                          |
| `patterns-decision-evidence.md` | Guide to retaining the decision evidence behind pattern responses.                  |
| `tidy.md`                 | Guide to formatting discern-owned prose and config surfaces; `order: 100`.                 |
| `concurrent-test-runs.md` | Guide to the Fleet-wide test-stage concurrency cap; `order: 110`.                          |

## Source files to read

- `discern.toml`
- `src/shared/config_schema.ts`
- `src/shared/result.ts`, `src/shared/result_schemas.ts`, and `src/shared/result_contracts.ts`
- `src/engine/gate/` and `src/engine/jobs/` (read `finish.ts`, `plan.ts`, `standard_plan.ts`, `standards_gate.ts`, `proof.ts`, `proof_notes.ts`, `proof_render.ts`, `test_slots.ts`, `tree_drift.ts`, and the job runner centrally; sample the remaining helpers)
- `src/engine/coupling/coupling.ts`
- `src/engine/improve/improve.ts`, `src/engine/improve/rules.ts`, and `src/engine/improve/types.ts`
- `src/engine/mcp/server.ts`
- `tests/engine_gate_*`, `tests/engine_standards_*`, `tests/engine_coupling_test.ts`, `tests/engine_gate_slots_test.ts`, `tests/engine_improvement_test.ts`, `tests/engine_proof_notes_test.ts`, `tests/engine_proof_render_test.ts`, `tests/result_schemas_test.ts`, and `tests/result_codegen_test.ts`
- `.github/workflows/release.yml` and `install.sh`

## Area owned

- The user-facing meaning and order of Gate stages, preconditions, scope gates, Standards, diagnostics, Proof, Proof-note transport, test-run concurrency, and strand detection.
- The `discern prepare`, `discern done`, `discern standards`, `discern improvement`, and `discern coupling` tasks as users encounter them.
- Continuous integration instructions for running the Gate outside the local Worktree workflow.

## Existing-doc content to preserve

- `when-the-gate-fails.md` keeps its failure-first task and direct diagnostic-to-fix route.
- `ci.md` keeps a complete GitHub Actions path, including a pinned binary, project toolchain setup, branch protection, and cloud-agent constraints.
- `../50-engine-internals/the-result-envelope.md` owns the result-envelope implementation contract.

## Known overlaps / handoffs

- **`../50-engine-internals/`** owns Zod schemas, generated result contracts, MCP adapters, and other envelope implementation details. The public section links to the reference contract.
- **`../70-reference/`** owns the public CLI, configuration, MCP tool, and result-field contracts. Link to its `mcp-and-results.md` contract.
- **`../30-worktrees/`** owns the wider Worktree lifecycle. This section describes how Proof validation affects a Gate handoff.

## Length-budget note

The README stays within 200–350 words. Troubleshooting stays within 300–700 words. Public guide and concept leaves stay within the subsystem hard ceiling of 400–800 words. The moved engine leaf follows the same 400–800-word ceiling.
