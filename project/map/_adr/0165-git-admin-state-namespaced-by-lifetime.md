# ADR 0165: Git-admin state shares one namespace without changing its lifetime

**Status**: accepted. Extends the resource-ledger placement ([ADR 0025](0025-worktree-resources.md)), the worktree-local gate and measurement receipts ([ADR 0067](0067-accept-validates-the-landed-tree.md), [ADR 0112](0112-standard-measurement-receipt.md)), the registry-driven forcing-function discipline ([ADR 0051](0051-canonical-set-parity.md)), and the validation-state preflight ([ADR 0152](0152-slow-workflows-prove-write-authority-first.md)).

## Context

Discern's state inside Git's administrative area grew in two shapes. The shared resource ledger and logbook already lived under `<git-common-dir>/discern/`, while the gate receipt, standard measurements, ignored-file baseline, and worktree-ready sentinel used flat `discern-*` names in each worktree's administrative directory. The scopes were correct: fleet history and resource ownership must converge across linked worktrees, while a receipt or setup marker must disappear with the worktree it describes. The filenames, however, made one subsystem look like several unrelated guests in `.git` and left no complete source of truth for Discern's Git-admin footprint.

The new `patterns reset` action sharpens the ownership boundary. It removes `<git-common-dir>/discern/logbook/` alone and must preserve every sibling Discern owns. A hand-written preservation case can protect today's nearest neighbour while missing the next state artifact. The same class of drift already led authored paths and provider artifacts to registries whose consumers and guards auto-enrol new members.

Moving every artifact to the common directory would produce the tidiest-looking tree, but would change the lifetime of worktree-local evidence. Git already owns automatic cleanup for `<git-common-dir>/worktrees/<key>/`; reproducing that lifecycle in a Discern-specific keyed directory would add stale-state reconciliation and collision risks for no functional gain.

## Decision

**Every Discern-owned Git-admin artifact lives at a registered path beneath `discern/`, while its registered scope preserves whether Git stores it per worktree or per repository.**

- One `GIT_ADMIN_STATE` registry records each artifact's relative path, scope, kind, and whether slow validation writes it.
- Shared state remains beneath the common Git directory: `discern/resources/` and `discern/logbook/`.
- Worktree-local state resolves through `git rev-parse --git-path`: `discern/gate-receipt`, `discern/standard-measurements`, `discern/ignored-baseline`, and `discern/worktree-ready`. In the main checkout these appear under `.git/discern/`; in a linked worktree they appear under `.git/worktrees/<key>/discern/` and vanish when Git removes that worktree.
- Production code may resolve `--git-path` only through the registry helper. Validation preflight derives its members from the registry's validation flag, and `patterns reset` tests preserve every registered non-logbook artifact. A new entry therefore joins the containment, routing, and reset guards from the same source.
- Writers create the nested namespace before use. Validation creates it during the early write-authority preflight, so the extra directory does not reintroduce a late failure after slow work.
- There are no legacy reads, migrations, fallback paths, or cleanup effects. This is a prelaunch path correction across four local installations; their old artifacts are handled manually rather than becoming permanent compatibility code.

## Consequences

- A repository's Git-admin area now presents one visible Discern namespace, and the artifact inventory is enumerable in code and documentation.
- The scope distinction remains intact. Shared history and ledgers still converge across the fleet; local receipts, baselines, and setup state still follow Git's own worktree cleanup.
- `patterns reset` can delete its one owned subtree without threatening current or future siblings, and the registry-driven test makes that promise grow with the footprint.
- Existing flat artifacts become inert after upgrade. Until they are removed or moved manually, they consume a small amount of disk and can make an old worktree appear to lack setup or validation state; Discern does not guess whether to preserve caches and sentinels.
- Adding Git-admin state now requires a registry entry and an explicit lifetime choice. That small ceremony makes ownership and cleanup semantics reviewable at the point of introduction.

## Alternatives considered

- **Keep the flat worktree-local filenames.** The paths function, but the split footprint obscures ownership and leaves future preservation checks dependent on copied lists. Rejected.
- **Put all state under `<git-common-dir>/discern/worktrees/<key>/`.** This makes one physical root but takes cleanup ownership away from Git and requires Discern to reconcile stale keys and path reuse. Rejected.
- **Read both old and new paths, then migrate or delete automatically.** That would make a four-repository prelaunch cleanup into a lasting branch in every reader and writer, with ambiguous precedence when both paths exist. Rejected at the owner's explicit boundary.
