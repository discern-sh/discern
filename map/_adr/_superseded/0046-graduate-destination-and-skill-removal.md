# ADR 0046: A configurable graduation destination, and removing the handoff-worktree skill

**Status**: superseded by [ADR 0110](../0110-the-landing-model.md)

> **Retired — superseded by [ADR 0110](../0110-the-landing-model.md) (the
> landing model).** The configurable destination below is gone: `graduate`
> always lands on the trunk, `[worktree].graduate_to` / `--to` were removed
> (schema 16→17 drops the key), and the composition flexibility moved to the
> pull axis (`start --from` / `integrate --from`). The skill removal decided
> below stands. Kept for history.

> **Consolidates [ADR 0048](0048-graduate-trunk-role-name.md).** The
> trunk-landing value introduced below as `"main"` was renamed to `"trunk"`
> (0048, folded in here). **Current values: `graduate_to = "branch" | "trunk"`**
> — read every `"main"` destination in the text below as the role now spelled
> `"trunk"`, which resolves to `[project].main_branch` (whatever a repo calls
> its trunk). A schema 11→12 migration carries a legacy `"main"` value forward.

## Context

`discern graduate` ([ADR 0023](../0023-rename-workflow-commands.md) promoted it
to a top-level verb) moves a finished worktree branch into the main checkout. It
had one fixed landing — check the branch out in the main repo for review — and
was fronted by a bundled **`handoff-worktree` skill**: ~50 lines telling the
agent to commit first, run `discern graduate`, relay the result, and not redo it
by hand with raw git.

Two problems had accumulated:

1. **The skill overlapped the verb almost entirely, and its bulk backfired.** It
   was the only bundled skill wrapping a single deterministic verb — the others
   (`document-subsystem`, `write-adr`) guide genuine multi-step judgement. A
   long "here is everything to weigh before handing off" playbook signals that
   there is a lot to weigh, so agents re-derived and hand-verified the same
   steps the verb runs deterministically — the opposite of its intent. It also
   split the vocabulary: the skill said "handoff", everything else said
   "graduate".

2. **The fixed landing didn't match the common case.** Graduating onto the
   branch leaves the user to fast-forward the trunk and delete the branch by
   hand — frequently the actually-wanted outcome, and done inconsistently (the
   leftover branch was sometimes cleaned up, sometimes not).

## Decision

**Give graduate a configurable destination, and delete the skill — relocating
its worthwhile parts onto discern's own surfaces.**

- **`--to branch|main`, defaulting to `[worktree].graduate_to` (shipped
  `branch`).** `branch` is the existing review-first landing (the branch is
  preserved, checked out in the main repo). `main` fast-forwards the trunk to
  the branch tip, checks the trunk out, and deletes the now-merged branch.
  `main` is a role, not a literal name — it means `[project].main_branch`.
  Resolution is explicit flag → config → `branch`.

  The graduation gate already requires the branch to contain the trunk, so
  fast-forwarding the trunk onto it is **always** a clean fast-forward (never a
  merge, never a conflict), and the branch is then fully merged, so
  `git branch -d` deletes it safely every time. The new destination therefore
  adds no new safety surface — it reuses the existing precondition as its proof.

- **Remove the `handoff-worktree` skill; relocate its value.** Per discern's own
  model — the tool is the surface, the instructions say when to reach for it
  ([ADR 0041](../0041-self-describing-mcp-surface.md)) — its three useful parts
  move to where every agent reads them, not only on a skill trigger:
  - "commit a real message first", "this is the single deterministic
    implementation — don't reproduce its git steps", and the destination → the
    always-on worktree guidance (`templates/guidance/worktrees.md`) and the
    `discern_graduate` tool description.
  - the natural-language handoff triggers ("graduate this", "I'll take it from
    here", "move this back to main") → the MCP server `instructions` block.

  This follows the precedent of [ADR 0024](0024-setup-command-not-skill.md),
  which retired the setup skill for a command: a single deterministic action is
  not a skill.

## Consequences

- The bundled skill set is now `document-subsystem` and `write-adr` — both
  genuine multi-step playbooks. `discern refresh` prunes the materialized
  `handoff-worktree` copy from every agent's skills directory.
- `[worktree].graduate_to` is a new config key (default `branch`), documented in
  the `discern.toml` template. The CLI gains `--to`, the MCP tool a `to`
  parameter, and the dry-run plan / live narration name the chosen landing
  (`fast-forward-trunk`
  - `delete-branch` steps replace `checkout` for `main`).
- The behind-main refusal message no longer implies `discern finish` integrates
  main (it gates on it; you run `git merge main`) — a stale-guidance papercut
  closed alongside.
- No schema migration: `graduate_to` carries a default, so an existing config
  validates unchanged and keeps the prior behaviour.

## Alternatives considered

- **Slim the skill to a stub instead of deleting it.** Rejected: a stub keeps
  the handoff-vs-graduate vocabulary split and a second artifact to maintain,
  for the marginal benefit of a `/handoff` slash-command entry point the
  enriched MCP instructions already cover.
- **Flip the shipped default to `main`.** Rejected for the generic distribution:
  review-first is the safe default for projects discern doesn't know. A project
  that prefers landing on the trunk sets `graduate_to = "main"` in its own
  `discern.toml` — exactly what the per-project default is for.
- **Accept an arbitrary branch name as the destination (rename-on-graduate).**
  Deferred: a distinct feature, not asked for; the two roles cover the need.
