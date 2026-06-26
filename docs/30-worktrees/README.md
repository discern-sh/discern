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
resource `ensure`), `WorktreeCreate` →
[`worktree:create`](../../src/lib/worktree_hooks.ts) (reads the hook's JSON
payload, adds the worktree, then runs first-time setup — which creates the
resources), `WorktreeRemove` →
[`worktree:remove`](../../src/lib/worktree_hooks.ts) (tears it down). Those two
hook entries parse their payload in the binary itself — no `jq`
([ADR 0040](../_adr/0040-worktree-hooks-in-the-binary.md)). When `main` advances
under a long-running Worktree,
[`integrate`](../../src/engine/worktree/lifecycle.ts) brings it into the branch
and re-materializes the agent files + skills in one step — the deterministic
inverse of graduate, and what the gate's merge check
([ADR 0050](../_adr/0050-merge-check-fail-fast.md)) points a behind branch at
([ADR 0055](../_adr/0055-integrate-verb.md)). When a change is done,
[`graduate`](../../src/engine/worktree/lifecycle.ts) graduates the branch into
the main repo and removes the Worktree — by default onto its own branch for
review, or with `--to trunk` (the `[worktree].graduate_to` default)
fast-forwarding the trunk to it and deleting the merged branch;
[`worktree:prune`](../../src/engine/worktree/lifecycle.ts) sweeps stale
Worktrees and **reclaims the resources of any Worktree that vanished without a
clean teardown** (the garbage-collection safety net).
[`worktree-name`](../../src/engine/worktree/identity.ts) resolves a Worktree's
stable identity (id / site / branch / port / db / worktree / resource).

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

Each effectful lifecycle verb — `worktree` (setup), `integrate`,
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
> [`document-subsystem`](../../templates/skills/document-subsystem/SKILL.md)
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
