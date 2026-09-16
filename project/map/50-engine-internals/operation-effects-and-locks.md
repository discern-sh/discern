---
title: Operation effects and exclusion
description: How CLI and MCP command paths declare effects, choose a shared-state boundary, and refuse conflicting writers.
order: 90
aliases:
  - operation effects
  - operation locks
  - concurrent discern commands
  - checkout lock
  - common repository lock
---

# Operation effects and exclusion

_A command path declares what it can affect before its command-line interface (CLI) or Model Context Protocol (MCP) body runs._

## The registry classifies commands

[`OPERATION_EFFECTS`](../../../src/shared/operation_effects.ts) is total over the live CLI command tree. Each command path declares one or more effect classes:

| Effect class                       | Meaning                                                                                        |
| ---------------------------------- | ---------------------------------------------------------------------------------------------- |
| observation                        | Reads and reports state without a discern-owned mutation.                                      |
| discern-owned checkout mutation    | Changes files or Git-admin evidence scoped to one checkout.                                    |
| discern-owned common mutation      | Changes common Git state, a trunk ref, the main checkout, or another repository-wide record.   |
| discern-owned Git mutation         | Writes Git administration, refs, indexes, objects, notes, worktrees, or discern's Git records. |
| Project-authored command execution | Runs a configured project command whose reachable effects belong to that command.              |
| External setup or resource effects | Runs setup, provider, resource, or lifecycle work that may change state outside the checkout.  |

The same entry declares a lock boundary, a Git-write-authority strategy, and a preview obligation. Mixed paths carry conditions for the flags or operands that activate their writer form. Ordinary dry runs acquire no writer lock. The registry does not treat a project-authored command as side-effect-free. Classification and exclusion remain distinct: `queue` uses its own concurrency authority, while Project Script execution holds the checkout boundary.

The preview field has 3 obligations:

| Obligation | Contract                                                                                                                                                                                       |
| ---------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `none`     | A pure observation needs no preview.                                                                                                                                                           |
| `disclose` | A reviewed standalone-preview exemption: the command names its explicit output, owned boundary, or project or external invocation at the relevant surface without predicting opaque internals. |
| `required` | The command path registers `--dry-run`, returns the uniform preview envelope, and has a fidelity probe.                                                                                        |

The mixed gate path `done` remains `required`: its plan lists work owned by discern and project command invocations even though the commands' internal effects are opaque. Pure runners such as `queue`, `test`, and Project Scripts use `disclose`. Explicit document exports name their caller-selected output; `prepare` names its fixer and refresh boundary rather than executing those effects during preview. Runner or orchestration status is not a blanket exemption for a path whose discern-owned writes have a faithful read-only plan.

[`tests/operation_effects_test.ts`](../../../tests/operation_effects_test.ts) derives nested and top-level command paths from the live tree. It requires one registry entry for each path, checks MCP parity, and holds every `required` member equal to the live `--dry-run` registrations. A planted classified writer without a flag proves policy enrolls the failure. [`engine_plan_parity_test.ts`](../../../tests/engine_plan_parity_test.ts) derives the fidelity population from the same registry, proves previews write nothing, and requires every applied effect owned by discern to appear in the plan. Apply may skip or refine work as later runtime facts become available; it may not escape the plan ([ADR 0335](../_adr/0335-operation-policy-enrolls-faithful-previews.md)).

[`scripts/canonical_sets.ts`](../../../scripts/canonical_sets.ts) enrolls the registry as a canonical set. Logbook routing has a separate recording concern and does not supply effect policy ([ADR 0330](../_adr/0330-every-command-path-declares-its-operation-effects.md)).

Command classification does not decide the sequencing of promise-returning calls inside an implementation. [Promise effect ownership](promise-effect-ownership.md) separately requires each promise-like value to stay in the caller's sequence or cross the exact `detachPromise` lifecycle boundary. A command can therefore have a correctly declared operation effect while one of its asynchronous steps has no completion owner.

## Git writers prove authority at the shared boundary

Every applied Git writer crosses one real-operation preflight while its lock is held. [`withOperationLock`](../../../src/engine/operation_lock.ts) asks Git for the common administration directory and exercises create, write, rename, and remove there. A checkout mutator also resolves and probes its Git administration and project root. Common-only writers do not resolve an unused checkout path. Denial returns `write_access`, naming the path and retry before the command body runs.

`gitWriteAuthority` distinguishes the broad boundary alone from a boundary supplemented by an exact effect plan. Gate, Standards, setup, and worktree creation add precise targets; central enrollment stays mandatory.

Observations, dry runs, and file-only writers do not probe Git. Project-authored commands and external effects stay opaque unless the path also declares a discern-owned Git mutation. Success proves only that moment; later operating-system or Git failures remain possible ([ADR 0338](../_adr/0338-operation-policy-enrolls-git-write-authority.md)).

## Lock boundaries follow shared state

The [operation policy](../../../src/shared/operation_effects.ts) selects invocation ownership. The common boundary is reserved for short publication and transition callbacks. Project commands, capacity admission, and human interaction refuse inside that boundary, including authenticated inherited child ownership.

Lifecycle commands retain their repository-wide lock while coordinating shared plans and bookkeeping. Their worktree reservations span creation, setup, validation, and removal. Checkout writers acquire the same path reservation before their Git-admin lock, including calls made from subdirectories. Resource operations hold an external-identity lease across the ownership check, command, and ledger settlement; a recycled Git key cannot admit another cleaner for that identity. These boundaries let unrelated worktrees publish completion evidence during slow setup or teardown ([ADR 0394](../_adr/0394-separate-operation-ownership-from-publication.md)).

Acceptance retains its own lock and author checkout. Each landing reserves the main checkout through transition, convergence, and cleanup; a competing writer there refuses while unrelated worktrees can finish. The common boundary joins for authority, consent, and the compare-and-swap with its journal and claim. Note recording, convergence, and resource cleanup run outside publication. A second acceptance waits on the acceptance boundary; checkout acquisition does not wait so a running completion can publish and finish.

[`withOperationLock`](../../../src/engine/operation_lock.ts) hashes repository, worktree, and resource identities into a fixed POSIX runtime namespace. Operating-system locks establish exclusion; file presence does not. The write preflight remains a separate authority check. Before Git administration exists, an explicit setup writer uses its canonical project directory.

All advisory-lock users share [`FileLock`](../../../src/shared/file_lock.ts). It releases the OS lock before closing the file: native I/O or a child process can keep a descriptor alive after its JavaScript handle closes. Record access carries no release methods. A [Linux regression test](../../../tests/file_lock_test.ts) holds a native read across release; the [enrollment guard](../../../tests/file_lock_guard_test.ts) keeps new lock users behind the same owner.

## Execution is observable before it waits

[`executeOperation`](../../../src/engine/operation_execution.ts) is the shared CLI and MCP execution boundary. It opens the existing operation journal before acquiring invocation locks. Previews and inactive observation forms write no journal. Nested cores retain the enclosing handle and identify their work within the parent operation; the outer result closes the journal. Child commands inheriting a live lease join its owner's journal without creating a newer competing record. A lost response can be recovered through `discern progress` even when the MCP request supplied no progress token.

A lock refusal identifies the operation recorded in the contended lease, including its available progress handle. That handle remains the holder's identity when a newer rejected invocation has become the latest journal. Inspect the named operation, then let its caller finish or cancel through that caller. Ending a client-side wait does not establish server cancellation, and a server PID does not identify an individual invocation.

## Nested commands reuse authenticated leases

[`operation_lock_context.ts`](../../../src/shared/operation_lock_context.ts) carries leases through async context and the child environment. Delegation is authenticated against the live operating-system lock and its token. Release restores inert record bytes and closes the owned handle.

Ordinary nesting cannot acquire another checkout or widen a checkout-only child to common ownership. Completion execution, lifecycle ownership, and acceptance provide explicit scopes for short publications. A setup probe retains its parent checkout and owns its new path through the lifecycle reservation. An integration copy joins under the landing's acceptance lock. Project-command and capacity boundaries reject common ownership before effects, including delegated leases.

The [policy guard](../../../tests/operation_effects_test.ts) and [execution guard](../../../tests/operation_execution_guard_test.ts) enroll future command and subprocess members. [Public lifecycle tests](../../../tests/engine_lifecycle_exclusion_test.ts) prove sibling completion and target exclusion together; [resource tests](../../../tests/worktree_resource_teardown_test.ts) exercise competing cleaners across recycled Git keys.

## Operations retain Git discovery

Repository discovery answers where a checkout's Git administration lives, where the shared common directory is, where a registered administrative artifact resolves, how the project root sits inside its work tree, and what a pinned object holds. Those answers change only when a worktree is added, moved, removed, pruned or repaired. Within one operation the engine is the only actor that does so.

[`withOperationLock`](../../../src/engine/operation_lock.ts) opens one discovery scope for the operation it runs. [`git_discovery.ts`](../../../src/shared/git_discovery.ts) owns the scope. Consumers declare the kind of fact they need. A miss runs git, with the two administration directories and the two work-tree positions each batched into one process. A hit replays the exact output git printed for the same query in the same directory, and only while the checkout still resolves and its administration directory still exists. Failures are never retained.

The scope ends with its operation, so a long-lived MCP server or desk session retains nothing between calls. Newly held exclusion and every `git worktree`, `git init`, `git submodule` or `git clone` invocation through `runGit` mark it stale: the next query re-observes the administration directories with one git process, and the answers derived from them survive only when that observation is unchanged. Code that runs outside an operation, including direct library calls and injected runners, observes git directly.

Evidence stays outside the scope: status and diff reads, ref verification, `symbolic-ref` and `worktree list` run fresh on every observation. [`git_discovery_test.ts`](../../../tests/git_discovery_test.ts) proves batching, exact replay and each boundary. [`engine_git_command_budget_test.ts`](../../../tests/engine_git_command_budget_test.ts) holds the proven-worktree journey to a per-verb ceiling on git processes ([ADR 0385](../_adr/0385-retain-git-discovery-within-one-operation.md)).

## Where it lives in code

| Concern                    | Source                                                                                                                                             |
| -------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------- |
| Effect policy              | [`operation_effects.ts`](../../../src/shared/operation_effects.ts)                                                                                 |
| Lock and broad preflight   | [`operation_lock.ts`](../../../src/engine/operation_lock.ts)                                                                                       |
| Real write probes          | [`write_preflight.ts`](../../../src/shared/write_preflight.ts), [`setup_effects.ts`](../../../src/shared/setup_effects.ts)                         |
| Nested and child leases    | [`operation_lock_context.ts`](../../../src/shared/operation_lock_context.ts)                                                                       |
| Git-admin identity         | [`git_admin_state.ts`](../../../src/shared/git_admin_state.ts)                                                                                     |
| Operation-scoped discovery | [`git_discovery.ts`](../../../src/shared/git_discovery.ts)                                                                                         |
| CLI interception           | [`main.ts`](../../../src/main.ts)                                                                                                                  |
| MCP interception           | [`server.ts`](../../../src/engine/mcp/server.ts)                                                                                                   |
| Policy and preview parity  | [`operation_effects_test.ts`](../../../tests/operation_effects_test.ts), [`engine_plan_parity_test.ts`](../../../tests/engine_plan_parity_test.ts) |

Logbook sealing and reset review the active snapshot and ask for confirmation before acquiring publication ownership. Under publication and logbook lifecycle exclusion, they re-read the snapshot and in-flight operations before detaching anything; changed evidence requires a fresh review.
