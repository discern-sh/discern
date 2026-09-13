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

| Boundary                | Scope                                                                                                                           |
| ----------------------- | ------------------------------------------------------------------------------------------------------------------------------- |
| None                    | Observations, dry runs, and inactive forms of mixed commands remain concurrent.                                                 |
| Checkout                | Writers in one checkout exclude another discern writer there; separate worktrees remain concurrent.                             |
| Common repository       | Linked worktrees exclude operations that share refs, the main checkout, or common Git-admin state.                              |
| Common and checkout     | The operation acquires the common boundary first, then the selected checkout boundary.                                          |
| Acceptance and checkout | A landing serializes on the dedicated acceptance boundary, then its author checkout; the common boundary joins per short phase. |

[`withOperationLock`](../../../src/engine/operation_lock.ts) resolves common or checkout identity from Git administration, hashes that identity into discern's fixed POSIX runtime namespace, and uses a non-blocking operating-system file lock there. The namespace does not follow caller-controlled temporary-directory variables, so parent and child processes cannot resolve different locks for the same Git boundary. Lock setup therefore consumes no repository-write authority; the separate real-operation probe proves it only for classified Git writers after exclusion is held. A standing path becomes inert when its process releases the file lock. A conflict refuses before the command body, names the held boundary, states that the call made no change, and routes the caller to retry after the active operation finishes.

Acceptance serializes on the dedicated acceptance boundary — where a second `accept`'s blocking turn-wait lives — and then acquires its author checkout non-blockingly, so a running `done` there refuses the landing instead of deadlocking against its own publication. The common boundary joins only for the transition core — authority recheck, consent resolution, and the compare-and-swap with its journal and claim — bounded like an ordinary completion publication; note recording, convergence, and every cleanup command run outside it, so neither a long combined check nor a slow teardown starves sibling completions. `done`, `prepare`, `refresh`, and other checkout writers hold the checkout boundary while mutable state and evidence must stay coherent. A discovered project without Git administration paths uses a host-temporary boundary keyed by its root. Explicit pre-project writers such as `setup` use the canonical current directory; other commands retain their ordinary not-initialized result ([ADR 0331](../_adr/0331-common-repository-locks-precede-checkout-locks.md)). The lock boundary governs exclusion; the Git-mutation effect independently governs whether the invocation performs a write probe.

## Nested commands reuse authenticated leases

Gate, setup, and lifecycle operations can invoke discern children. [`operation_lock_context.ts`](../../../src/shared/operation_lock_context.ts) carries held leases through async context and an internal child environment value. The lock file's random token authenticates that delegation only while another process holds the file's operating-system lock; release restores the prior inert bytes.

A nested operation can reuse a lease its parent holds. Ordinary nested operations cannot acquire common after checkout, acquire a second checkout, or widen a child from a checkout-only parent; completion execution and a held acceptance boundary are the two reviewed exceptions, each acquiring common in publication-bounded phases, and only a landing's integration copy may join as a second checkout under that held boundary. Those refusals preserve the common-before-checkout order and prevent nested deadlock. [`tests/operation_lock_test.ts`](../../../tests/operation_lock_test.ts) exercises the shared acceptance boundary, same-checkout refusal, orphan path, pre-Git boundary, acquisition order, MCP routing, and separate-worktree concurrency.

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
