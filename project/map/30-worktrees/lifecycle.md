---
title: Start, update, and accept
description: What discern creates at start, refreshes at update, and removes after an accepted worktree lands.
order: 10
aliases:
  - discern start
  - discern update
  - discern accept
  - worktree lifecycle
  - can't edit main
  - update my branch
  - resume a worktree
  - follow-up fixes
---

# Start, update, and accept a worktree

_Keep one worktree from the first edit through review feedback and resumed sessions. Update it, prove it, and land the validated commit._

## Start an isolated checkout

From the main checkout, `discern start` creates and readies a worktree for an effort that has none, then returns its path. Keep that path for review feedback, requested fixes, and resumed sessions. If a later session opens in the main checkout, continue at the recorded path and pass `path` to discern tools. Ask the owner when the path is unavailable. Calling `start` again creates a separate sibling worktree. New worktrees start from the configured trunk unless `--from <ref>` names unlanded or experimental work ([ADR 0058](../_adr/0058-start-verb-spawn-worktree-from-trunk.md), [ADR 0110](../_adr/0110-the-landing-model.md)).

An optional name becomes a branch-safe slug; otherwise discern generates a codename. It checks the directory, branch, and port for collisions first ([ADR 0109](../_adr/0109-worktree-start-optional-name.md)).

The default is `<repo>.worktrees/<id>` beside the repository; `[worktree].root` overrides it. Nested worktrees confuse recursive tools and root discovery ([ADR 0052](../_adr/0052-worktree-sibling-placement.md)).

Setup runs in this order:

| Phase                | Result                                                                              |
| -------------------- | ----------------------------------------------------------------------------------- |
| Branch               | Creates or confirms the worktree branch.                                            |
| Environment          | Copies declared values from the main checkout.                                      |
| Resources            | Creates each declared resource and records its handle.                              |
| Identity             | Records the deterministic port when `[worktree].port` is on and an env file exists. |
| One-time setup       | Runs `[worktree.setup].steps` only for a fresh worktree.                            |
| Shared convergence   | Runs `[repository].ensure` for checkout-generic dependencies and generated state.   |
| Worktree convergence | Runs `[worktree.setup].ensure` for commands that depend on worktree identity.       |
| Agent files          | Uses the new checkout's engine to rebuild guidance and materialize skills.          |

`start` refuses an unborn repository, a missing trunk, a nested `discern.toml`, an unknown or ambiguous `--from` ref, an occupied branch or directory, or a call from another worktree. `accept` applies the repository-root boundary too, so a nested project cannot land sibling changes. Main-checkout edits stay there. A failed creation removes only its branch and checkout.

## Bring the trunk into the branch

`discern update` merges trunk or `--from`, requires tracked-clean files, and leaves untracked scratch.

Only wholly generated conflicts auto-resolve; others abort. `update` merges one side, runs and commits every generator, refreshes Agent files, then runs both ensures. No-ops converge ([ADR 0055](../_adr/0055-update-verb.md), [ADR 0059](../_adr/0059-worktree-setup-ensure.md), [ADR 0153](../_adr/0153-repository-owns-shared-checkout-convergence.md)). Temporary bytes cannot determine output; failures remain visible ([ADR 0247](../_adr/0247-generated-artifacts-regenerate-never-merge.md)).

On first setup, provisioned worktrees with a managed block install `merge.discern-generated.driver`. Raw merge keeps the marked side without conflict markers; `done` or `update` regenerates it. Plain clones, CI, and main lack the driver (never global), so conflicts remain; `update` still resolves generated paths ([ADR 0247](../_adr/0247-generated-artifacts-regenerate-never-merge.md), [ADR 0093](../_adr/0093-upgrade-reconciles-gitignore-block.md)).

Use `[repository].ensure` for checkout-safe commands and `[worktree.setup].ensure` for identity-dependent ones; `[worktree.setup].steps` remains one-shot.

## Land the reviewed commit

Commit the final tree and run `discern done`. Landing then needs [landing authority](landing-authority.md): conversation consent, a standing scope grant on the trunk, or a one-worktree effort grant from the desk. `start`, `status`, and a green `done` report the shared decision. Uncovered work returns to receipt review with every checkout untouched ([ADR 0134](../_adr/0134-accept-attests-consent.md), [ADR 0194](../_adr/0194-standing-pre-authorization-is-a-recorded-checked-grant.md)).

Acceptance requires the latest trunk, a clean and unlocked worktree, and a tracked-clean main checkout on the trunk. Ignored or untracked main-checkout data may stay unless landing would overwrite it. It validates the commit that will land. An honored `discern done` receipt skips a duplicate gate run; any later commit invalidates it ([ADR 0067](../_adr/0067-accept-validates-the-landed-tree.md)).

On success, discern records `conversation`, `standing-grant` with scopes, or `effort-grant` in the result, receipt, and logbook. It fast-forwards the trunk, writes the structured receipt under `refs/notes/discern`, refreshes the main checkout, runs `[repository].ensure` and `smoke`, and reports tracked changes. It then destroys resources, removes the worktree, and deletes the branch ([ADR 0098](../_adr/0098-accept-refreshes-the-landing-checkout.md), [ADR 0153](../_adr/0153-repository-owns-shared-checkout-convergence.md), [ADR 0215](../_adr/0215-landing-receipts-travel-as-git-notes.md)). If another change lands during validation, acceptance keeps this worktree for `update → done → accept`.

The receipt note preserves green landing evidence without adding a trunk commit. Its local write is default-on and fail-open. `[repository].receipt_notes = "fetch"` adds fetch transport; publication remains explicit. [Receipt notes](../20-quality-gate/receipt-notes.md) covers the ref, command, and cross-clone recovery.

Acceptance journals its transition and recovers without replaying one-shot authority or overwriting changed checkout data. Post-landing convergence cannot roll the trunk back, so later failures report the effects that already happened and cleanup continues. [Interrupted landing recovery](acceptance-recovery.md) covers the evidence, refusal paths, and `partial_acceptance` result ([ADR 0194](../_adr/0194-standing-pre-authorization-is-a-recorded-checked-grant.md)).

## Remove abandoned work

From the main checkout, `discern worktree drop <id|path>` removes an abandoned worktree and branch. A bare id or directory name must identify 1 registered worktree. If several paths share it, discern lists them and requires the selected path. Uncommitted or unlanded work needs human `--force`. A git lock still protects it. If Git cannot read the worktree's status, discern treats its cleanliness as unknown and requires `--force`. The command is CLI-only because agents cannot discard another line of work.

After confirmation, `discern worktree prune` removes clean merged worktrees, stale registrations, orphan directories, and resource records. It rechecks eligibility before removal.

Prune also reports **contained** worktrees — spent `start --from` stages whose commits already travel inside a live sibling branch. The default apply never touches them. [Reclaiming contained worktrees](reclaiming-contained-worktrees.md) covers the predicate, the `--contained` opt-in, and the kept branch refs.

## Where it lives in code

| Responsibility                | Source                                                                                                    |
| ----------------------------- | --------------------------------------------------------------------------------------------------------- |
| Lifecycle plans and execution | [`src/engine/worktree/lifecycle.ts`](../../../src/engine/worktree/lifecycle.ts)                           |
| Acceptance recovery journal   | [`src/engine/worktree/acceptance_transaction.ts`](../../../src/engine/worktree/acceptance_transaction.ts) |
| Landing-authority resolution  | [`src/engine/worktree/landing_authority.ts`](../../../src/engine/worktree/landing_authority.ts)           |
| Receipt-note recording        | [`src/engine/gate/receipt_notes.ts`](../../../src/engine/gate/receipt_notes.ts)                           |
| Git preconditions and removal | [`src/engine/worktree/git.ts`](../../../src/engine/worktree/git.ts)                                       |
| Contained-worktree scan       | [`src/engine/worktree/containment.ts`](../../../src/engine/worktree/containment.ts)                       |
| Plan rendering                | [`src/engine/worktree/plan.ts`](../../../src/engine/worktree/plan.ts)                                     |
| Lifecycle tests               | [`tests/engine_worktree_test.ts`](../../../tests/engine_worktree_test.ts)                                 |
| Generated-update tests        | [`tests/engine_generated_update_test.ts`](../../../tests/engine_generated_update_test.ts)                 |

## Current state and gotchas

- Every effectful lifecycle command supports `--dry-run`; inspect destructive plans before applying them ([ADR 0027](../_adr/0027-plan-apply-engine-execution.md)).
- `accept` removes the worktree, so any tracked, untracked, or staged change there blocks landing. The main checkout blocks only on tracked changes.
- Acceptance reports top-level ignored paths that changed since setup. Those paths stay outside git cleanliness.
- Receipt-note recording and fetch-configuration reconciliation follow the trunk fast-forward. Their failures report a cause once and cannot fail or undo acceptance; the later checkout refresh does not retry transport.
- A first setup-step or convergence failure aborts creation. discern reports later convergence failures without undoing a completed update, blocking session start, or interrupting post-landing cleanup.
- `discern doctor` reports repository layouts that `start` and `accept` cannot use.
