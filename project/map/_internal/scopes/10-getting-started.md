# Scope: 10-getting-started

Read [`project/map/_internal/documenter-agent-brief.md`](../documenter-agent-brief.md) first.

## What this subtree documents

The public path from installing discern through setup, a first Gate-checked change, troubleshooting, and later upgrades. Engine implementation details belong in `50-engine-internals`; lookup contracts belong in `70-reference`.

## Files to produce

| File                 | Topic                                                                                                    |
| -------------------- | -------------------------------------------------------------------------------------------------------- |
| `README.md`          | 200–350-word overview with the curated reading order.                                                    |
| `quickstart.md`      | Approved quickstart exemplar; preserve its register and update only required links or location metadata. |
| `walkthrough.md`     | Guided tour that adds detail after the quickstart.                                                       |
| `after-setup.md`     | Guide to the files a reader sees after setup.                                                            |
| `setup-decisions.md` | Guide to the durable choices setup records and how to revisit them.                                      |
| `tasks.md`           | Task index that routes readers to the supported first-use workflows.                                     |
| `faq.md`             | Troubleshooting page led by `discern doctor`.                                                            |
| `upgrade-discern.md` | Task guide for updating the binary and then the project.                                                 |

## Source files to read

- `src/commands/upgrade.ts` (read in full)
- `src/lib/migrations.ts` and `src/lib/version.ts` (migration contract and update channel)
- `src/commands/setup.ts` and `src/commands/doctor.ts` (sample the user-visible setup and diagnostic paths)
- `tests/upgrade_migrations_test.ts`, `tests/upgrade_check_test.ts`, and `tests/upgrade_edge_test.ts` (upgrade behavior)
- `install.sh` (binary installation channel and supported platforms)

## Area owned

- Installation, setup handoff, first-use flow, setup aftermath, and user-facing upgrades.
- The `10-getting-started` Map path and its task-oriented installation, setup, and upgrade pages.

## Existing-doc content to preserve

Keep the approved `quickstart.md` exemplar's wording and register unchanged. Update only required links or metadata.

## Known overlaps / handoffs

- **`../20-quality-gate/`** owns Gate mechanics and failure diagnosis after a Gate starts running.
- **`../50-engine-internals/`** owns migration implementation details moved out of the public task guide.
- **`../70-reference/`** owns the generated config reference and Files and ownership exemplar.

## Length-budget note

Use the page-type budgets in [`page-templates.md`](../page-templates.md): README 200–350 words, walkthrough and upgrade guides 500–900 words, and troubleshooting 300–700 words. The fixed exemplars keep their approved lengths.
