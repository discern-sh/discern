# Scope: 30-worktrees

Read [`documenter-agent-brief.md`](../documenter-agent-brief.md) first.

## What this subtree documents

This subtree documents the public Worktree workflow: isolation, identity, resources, Fleet coordination, Landing authority, and the path from task start to accepted cleanup. Gate internals belong in `20-quality-gate`; exact command and result contracts belong in `70-reference`.

## Files to produce

| File                       | Topic                                                                              |
| -------------------------- | ---------------------------------------------------------------------------------- |
| `README.md`                | Public overview and curated reading order.                                         |
| `lifecycle.md`             | Start, update, acceptance, abandoned-work cleanup, and refusal paths; `order: 10`. |
| `the-trunk.md`             | The shared landing branch and its ownership boundary; `order: 20`.                 |
| `the-resources.md`         | Resource creation, records, teardown, and recovery for each Worktree; `order: 30`. |
| `identity-and-env.md`      | Worktree ids, ports, environment values, and runtime discovery; `order: 40`.       |
| `team-workflow.md`         | Fleet ownership and composing concurrent branches; `order: 50`.                    |
| `multi-repo-workspaces.md` | Repository boundaries, registries, umbrellas, and submodules; `order: 60`.         |
| `status.md`                | Local and Fleet status, Proof, collisions, and session hints; `order: 70`.         |
| `the-desk.md`              | The human Fleet view and its valid actions; `order: 80`.                           |
| `landing-authority.md`     | Conversation consent and recorded grants across the lifecycle; `order: 90`.        |
| `acceptance-recovery.md`   | Interrupted landing evidence, reconciliation, and partial results; `order: 100`.   |
| `hand-work-back.md`        | Finish, report, review, revise, accept, and delegate follow-on work; `order: 110`. |

## Source files to read

- `discern.toml` and `src/shared/config_schema.ts`
- `src/engine/worktree/` (read `lifecycle.ts`, `landing_authority.ts`, the `effort_grant*.ts` capability split, `identity.ts`, and `resources.ts` centrally; sample the remaining helpers)
- `src/engine/status/status.ts`, `src/engine/desk/`, and `src/engine/gate/finish.ts`
- `src/shared/consent.ts`, `src/shared/hints.ts`, and `src/shared/result_schemas.ts`
- `tests/engine_worktree_test.ts`, `tests/engine_status_test.ts`, `tests/engine_desk_*`, and `tests/engine_lifecycle_authority_test.ts`

## Area owned

- The public Worktree lifecycle, Fleet ownership model, identity, resources, status, Desk, Landing authority, and handoff workflow.
- The relationship between a Worktree's branch, the Trunk, its Proof, and the evidence that authorizes landing.

## Existing-doc content to preserve

- `lifecycle.md` keeps the complete setup order, update convergence, landing preconditions, and cleanup behavior.
- `hand-work-back.md` keeps the Proof-first review workflow and dependent follow-on composition.
- `multi-repo-workspaces.md` keeps one discern install per repository as its boundary.

## Known overlaps / handoffs

- **`../20-quality-gate/`** owns Gate scheduling, Standards, and Proof construction. This subtree owns how Proof participates in handoff and acceptance.
- **`../50-engine-internals/`** owns the implementation architecture behind lifecycle plans and results.
- **`../70-reference/`** owns exact command-line interface (CLI), config, Model Context Protocol (MCP), and result-field contracts.

## Length-budget note

The README uses the 200–350-word overview budget. New guide leaves stay within 400–800 words. Existing reference-rich workflow pages retain their complete command and recovery coverage; split them on a future substantive refresh rather than trimming safety details.
