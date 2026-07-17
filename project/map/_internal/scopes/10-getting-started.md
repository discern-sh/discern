# Scope: 10-getting-started

Read [`project/map/_internal/documenter-agent-brief.md`](../documenter-agent-brief.md) first.

## What this subtree documents

The public path from installing discern through setup, a first gated change, troubleshooting, and later upgrades. Engine implementation details belong in `50-engine-internals`; lookup material belongs in `70-reference`.

## Files to produce

| File                 | Topic                                                               |
| -------------------- | ------------------------------------------------------------------- |
| `README.md`          | 200–350-word overview with the curated reading order.               |
| `quickstart.md`      | Approved quickstart exemplar; relocate and link without re-styling. |
| `walkthrough.md`     | Guided tour that adds detail after the quickstart.                  |
| `after-setup.md`     | Guide to the files a reader sees after setup.                       |
| `faq.md`             | Troubleshooting page led by `discern doctor`.                       |
| `upgrade-discern.md` | Task guide for updating the binary and then the project.            |

## Source files to read

- `src/commands/upgrade.ts` (read in full)
- `src/lib/migrations.ts` and `src/lib/version.ts` (migration contract and update channel)
- `src/commands/setup.ts` and `src/commands/doctor.ts` (sample the user-visible setup and diagnosis paths)
- `tests/upgrade_migrations_test.ts`, `tests/upgrade_check_test.ts`, and `tests/upgrade_edge_test.ts` (upgrade behavior)
- `install.sh` (binary installation channel and supported platforms)

## Area owned

- Installation, setup handoff, first-use flow, setup aftermath, and user-facing upgrades.
- The `10-getting-started` map path and its task-oriented installation, setup, and upgrade pages.

## Existing-doc content to preserve

The approved `quickstart.md` exemplar is not re-styled.

## Known overlaps / handoffs

- **`../20-quality-gate/`** owns gate mechanics and failure diagnosis after a gate starts running.
- **`../50-engine-internals/`** owns migration implementation details moved out of the public task guide.
- **`../70-reference/`** owns the generated config reference and Files & ownership exemplar.

## Length-budget note

Use the page-type budgets in [`page-templates.md`](../page-templates.md): README 200–350 words, walkthrough and upgrade guides 500–900 words, and troubleshooting 300–700 words. The fixed exemplars keep their approved lengths.
