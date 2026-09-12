# Scope: 30-worktrees

Read [`documenter-agent-brief.md`](../documenter-agent-brief.md) first.

## What this subtree documents

This subtree documents the public worktree workflow: isolation, identity, resources, Fleet coordination, Landing authority, and the path from task start to accepted cleanup. Gate internals belong in `20-quality-gate`; exact command and result contracts belong in `70-reference`.

## Files to produce

| File                                | Shape    | Topic                                                                                    |
| ----------------------------------- | -------- | ---------------------------------------------------------------------------------------- |
| `README.md`                         | overview | Public overview and curated reading order.                                               |
| `lifecycle.md`                      | guide    | Start, update, acceptance, abandoned-work cleanup, and refusal paths; `order: 10`.       |
| `the-trunk.md`                      | guide    | The shared landing branch and its ownership boundary; `order: 20`.                       |
| `the-resources.md`                  | guide    | Resource creation, records, teardown, and recovery for each Worktree; `order: 30`.       |
| `identity-and-env.md`               | guide    | Worktree ids, ports, environment values, and runtime discovery; `order: 40`.             |
| `team-workflow.md`                  | guide    | Fleet ownership and composing concurrent branches; `order: 50`.                          |
| `awaiting-the-fleet.md`             | guide    | Waiting for a sibling branch or the Trunk without polling or stale status prose.         |
| `multi-repo-workspaces.md`          | guide    | Repository boundaries, registries, umbrellas, and submodules; `order: 60`.               |
| `status.md`                         | guide    | Local and Fleet status, Proof, collisions, and session hints; `order: 70`.               |
| `the-desk.md`                       | guide    | The human Fleet view and its valid actions; `order: 80`.                                 |
| `desk-tips.md`                      | guide    | Task-focused interpretation of Desk tips and next actions.                               |
| `opening-worktrees.md`              | guide    | Supported ways to enter an assigned worktree without splitting an effort.                |
| `landing-authority.md`              | guide    | Conversation consent and recorded grants across the lifecycle; `order: 90`.              |
| `emergency-integration.md`          | guide    | Explicit emergency consent, durable exceptions, and subsequent validation.               |
| `acceptance-recovery.md`            | guide    | Interrupted landing evidence, completion or rollback, and partial results; `order: 100`. |
| `cleanup-ownership.md`              | guide    | Ownership rules for removing stale worktrees, branches, and resource records.            |
| `drop-recovery.md`                  | guide    | Recovery paths after an interrupted or partially applied drop operation.                 |
| `reappeared-worktree-paths.md`      | guide    | Diagnosis and recovery when a removed worktree path returns.                             |
| `reclaiming-contained-worktrees.md` | guide    | Safe reclamation of worktrees contained by another workspace boundary.                   |
| `hand-work-back.md`                 | guide    | Finish, report, review, revise, accept, and delegate follow-on work; `order: 110`.       |

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

The declared page shapes use the defaults in [`page-templates.md`](../page-templates.md). Existing reference-rich workflow pages retain their complete command and recovery coverage; split them on a substantive refresh instead of trimming safety detail. No local numeric exception is declared.
