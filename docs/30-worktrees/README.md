# The isolated-worktree workflow

_Throwaway git Worktrees so an agent never works in the main checkout._

This subtree covers the Worktree lifecycle. The `discern worktree*` verbs
provision and tear down an isolated `git worktree` (and its branch) per change,
each with a **deterministic dev-server port** and any number of project-declared
**resources** — external things (a database, an emulator, a container, a queue)
that must exist for exactly the life of the Worktree. The git mechanics are
generic; the resources are the only stack-specific part, declared as
`[worktree.resources.<name>]` tables in `discern.toml`. A fresh install declares
none, so a Worktree round is a clean no-op until a project wires one. The whole
workflow is the `worktrees` feature, which can be turned off in `[features]`
(ADR 0011, ADR 0025).

The lifecycle is driven by hooks in `.claude/settings.json`: `SessionStart` →
[`worktree:ensure`](../../src/engine/worktree/lifecycle.ts) (idempotent setup +
resource `ensure` + `[worktree.setup].ensure`), `WorktreeCreate` →
[`worktree:create`](../../src/lib/worktree_hooks.ts) (reads the hook's JSON
payload, adds the worktree, then runs first-time setup — which creates the
resources and runs `[worktree.setup]`: the one-shot `steps`, then the convergent
`ensure`), `WorktreeRemove` →
[`worktree:remove`](../../src/lib/worktree_hooks.ts) (tears it down). Those two
hook entries parse their payload in the binary itself — no `jq`
([ADR 0040](../_adr/0040-worktree-hooks-in-the-binary.md)). An agent on the
**main checkout** that needs its own Worktree runs
[`start`](../../src/engine/worktree/lifecycle.ts): it mints a fresh id, creates
the Worktree on its own `agent/` branch at the sibling location, sets it up, and
reports the path to move into — the agent-initiated counterpart to the
`WorktreeCreate` hook, and the first-class alternative to squatting in another
line of work's Worktree
([ADR 0058](../_adr/0058-start-verb-spawn-worktree-from-trunk.md)). It only ever
_creates_ a Worktree to inhabit; it never adopts or prunes an existing one. When
`main` advances under a long-running Worktree,
[`integrate`](../../src/engine/worktree/lifecycle.ts) brings it into the branch,
re-materializes the agent files + skills, and re-runs `[worktree.setup].ensure`
so a merge that changed a lockfile leaves the worktree's dependencies current —
all in one step. It merges only into a tracked-clean tree: tracked edits that
have not been committed must be committed or stashed first, while untracked
local/session scratch files are left alone. It is the deterministic inverse of
graduate, and what the gate's merge check
([ADR 0050](../_adr/0050-merge-check-fail-fast.md)) points a behind branch at
([ADR 0055](../_adr/0055-integrate-verb.md),
[ADR 0059](../_adr/0059-worktree-setup-ensure.md)). When a change is done,
[`graduate`](../../src/engine/worktree/lifecycle.ts) validates the exact tree it
is about to land — running the whole gate, or skipping the re-run when a
gate-pass receipt proves the agent's own `finish` already passed this commit
([ADR 0067](../_adr/0067-graduate-validates-the-landed-tree.md)) — then
graduates the branch into the main repo and removes the Worktree, landing per
`[worktree].graduate_to` (or `--to` per run): onto its own branch for review, or
fast-forwarding the trunk to it and deleting the merged branch. Its
main-checkout precondition also cares about tracked changes, not untracked local
scratch; the worktree migration step remains stricter because it deliberately
WIP-commits any leftover worktree changes (tracked or untracked) before removing
the checkout; [`worktree:prune`](../../src/engine/worktree/lifecycle.ts) sweeps
stale Worktrees and **reclaims the resources of any Worktree that vanished
without a clean teardown** (the garbage-collection safety net).
[`worktree-name`](../../src/engine/worktree/identity.ts) resolves a Worktree's
stable identity (id / site / branch / port / db / worktree / resource).

**Proving a copy works.** The same create → setup → removal cores back a further
use: `setup done`'s **worktree-viability probe**
([ADR 0090](../_adr/0090-setup-proves-worktree-viability.md)). Setup proves the
gate in the main checkout — the one place an agent never works — so before it
records completion it also creates a THROWAWAY Worktree from the current branch
(via [`probeWorktreeViability`](../../src/engine/worktree/lifecycle.ts)), runs
the gate inside it, and tears it down win or lose. A project that passes in the
main checkout but breaks in a copy — an env-anchored app whose untracked `.env`,
dependency dir, or absolute-path assumption never travels — fails setup with a
named `worktree_probe` stage, so the wiring that makes a copy viable
(`[worktree].steps` / `ensure` / `resources` / `inherit_env`) is fixed while a
capable agent is present, not discovered on the first real task. `smoke` — a
fast "does it boot?" [Capability](../00-orientation/glossary.md#capability) —
makes that probe sharp: because `discern finish` runs it wherever the gate runs,
every finish re-proves the app boots in a Worktree too.

**Where they land.** `WorktreeCreate` places each checkout under
`[worktree].root`: by default a **sibling** of the repo
(`<repo>.worktrees/<name>`), visible and adjacent rather than nested inside it
(a nested worktree is an anti-pattern — recursive tools double-count it, and a
walk-up to the repo root mis-resolves the worktree's `.git` file). A relative
`root` resolves against the repo root (`.claude/worktrees` nests them inside the
repo); an absolute one is used as-is. The engine stays location-agnostic — it
discovers existing Worktrees from git's own registry, never a hardcoded path —
so only the create hook and `worktree:prune`'s orphan sweep know the convention
([ADR 0052](../_adr/0052-worktree-sibling-placement.md)).

Each effectful lifecycle verb — `start`, `worktree` (setup), `integrate`,
`worktree:teardown`, `worktree:prune`, and `graduate` — takes a `--dry-run` that
prints the plan (what it _would_ create, destroy, reclaim, move, or merge) and
touches nothing, plus a `--json` serialization of plan + results
([ADR 0027](../_adr/0027-plan-apply-engine-execution.md)). The destructive ones
— prune's GC and graduation's WIP-commit / remove / checkout dance — are
inspectable before they act.

## Leaves

| File                                 | Covers                                                                                                                                                                    |
| ------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [the-resources.md](the-resources.md) | Per-worktree resources: the config seam, the create/reuse/destroy lifecycle, the ledger + orphan GC, identity, ownership/namespacing, and the runtime-discovery contract. |

> **Status: partial.** `the-resources.md` is written; the remaining lifecycle /
> identity / integration leaves are still stubs — fill them with the
> [`discern-document-subsystem`](../../templates/skills/discern-document-subsystem/SKILL.md)
> skill.

## See also

- [concepts.md](../00-orientation/concepts.md) — where Worktrees sit in the
  loop.
- [ADR 0011](../_adr/0011-adopt-worktree-workflow.md) — why the harness adopted
  this workflow.
- [ADR 0025](../_adr/0025-worktree-resources.md) — generalizing the
  db/dev-server adapters into per-worktree resources with orphan GC.
- [ADR 0052](../_adr/0052-worktree-sibling-placement.md) — placing Worktrees in
  a configurable sibling directory instead of nested `.claude/worktrees`.
- [ADR 0055](../_adr/0055-integrate-verb.md) — `integrate`, the third verb in
  the worktree lifecycle: bring `main` into the branch and re-materialize in one
  deterministic step.
- [ADR 0058](../_adr/0058-start-verb-spawn-worktree-from-trunk.md) — `start`,
  the verb that spawns a Worktree from the main checkout, and the
  `discern status` guardrail that points an agent on the trunk at it.
- [ADR 0059](../_adr/0059-worktree-setup-ensure.md) — `[worktree.setup].ensure`,
  the convergent bucket that re-runs every pass (creation, session start,
  integrate) to keep the worktree's environment current with the tree.
