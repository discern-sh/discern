## Isolated worktree workflow

discern runs each line of work in its own **linked git worktree**, so concurrent
efforts never collide.{{#if has_worktree_resources}} A project can declare per-worktree external
**resources** (a database, an emulator, a container) that discern provisions and
tears down per worktree; for the lifecycle and how to discover a resource's
handle, call **`discern_help`**.{{/if}}

- A worktree is created on its own branch (prefixed `{{branch_prefix}}`). The
  create hook (`discern worktree:create`) adds it and sets it up:{{#if has_worktree_resources}} it provisions the declared
  resources,{{/if}} records a deterministic
  dev-server port{{#if has_worktree_resources}} + the resource handles{{/if}} into `.env`, inherits env vars, runs the
  configured setup steps, and freshly materializes skills + guidance.
- **`discern start`** — run from the main checkout — creates your own worktree on
  its own `{{branch_prefix}}<id>` branch, sets it up, and reports the path to
  **move into** (nothing relocates you, so don't keep working on the trunk). It
  only ever *creates* a worktree to inhabit (never adopts), and refuses from inside
  one.
- **`discern integrate`** is the deterministic inverse of graduate: it brings
  `{{main_branch}}` into the worktree branch and re-materializes the agent files +
  skills in one step. Run it whenever the branch is behind `{{main_branch}}` (the
  gate's merge check points here). It is safe and idempotent — a no-op when already
  up to date — and never touches the main checkout. Just call it — you don't need
  to run `git` to check first: the tool performs every precondition itself and
  returns exactly what to do next (a dirty tree, a merge conflict), so reproducing
  its steps by hand is slower and usually unnecessary.
- **`discern graduate`** hands the current worktree's branch back to the main
  checkout. It is the single deterministic implementation of that handoff — just
  call it rather than moving the branch by hand, and relay its result; you don't
  need to pre-flight the preconditions with `git`, since it refuses cleanly with
  the exact next step. Commit your work
  with a real message first, so it lands as a proper review commit. By default it
  lands on its own branch for review; pass **`--to trunk`** to fast-forward
  `{{main_branch}}` to the branch tip and delete the now-merged branch instead (set
  the per-project default with `[worktree].graduate_to`). It refuses if the branch
  is behind `{{main_branch}}` — run `discern integrate` and re-run — or if the main
  checkout is dirty.
- **`discern worktree:prune`** sweeps stale worktrees and fully-merged branches{{#if has_worktree_resources}} (reclaiming the resources of any that vanished without a clean teardown){{/if}}. `--dry-run` reports without acting.

Resolve a worktree's stable identity with **`discern worktree-name`**
(`--id`/`--site`/`--branch`/`--port`/`--db`/`--worktree`{{#if has_worktree_resources}}/`--resource <name>`{{/if}}). Do
your work inside the worktree, not the main checkout.

**A worktree belongs to exactly one line of work — never start work in a worktree
you didn't create.** A clean working tree does *not* mean it's free: another agent
may be planning, reading, or discussing in it without having written anything yet.
Operate only in the worktree you were launched into (or the main checkout). The
worktrees `discern status` lists are a *survey of other efforts in flight*, not a
pool to claim from — if you're on the main checkout and the task needs its own
isolated workspace, run **`discern start`** to *create* your own, never
repurposing an existing one.
