# ADR 0052: Worktrees live in a configurable sibling directory, not nested `.claude/worktrees`

> **Vocabulary amendment ([ADR 0120](0120-launch-verb-canon.md)):** Current
> pointers use `graduate` → `accept`; the decision and reasoning are unchanged.

**Status**: accepted

## Context

discern is stack- _and_ agent-neutral, but its isolated-worktree workflow placed
every linked worktree at `<repo>/.claude/worktrees/<name>` — a path baked into
the Claude Code worktree-create hook
([ADR 0040](0040-worktree-hooks-in-the-binary.md)). That location was wrong on
three counts:

1. **`.claude/` is Claude-Code-specific.** Nesting _every_ agent's worktree
   under one vendor's folder is a category error for an agent-agnostic tool. A
   Codex or Gemini session has no reason to live under `.claude/`.
2. **A worktree nested inside its own repo is a documented anti-pattern.**
   Recursive tools double-count it — including discern's own gate, which globs
   the tree under `**`; IDEs mis-index the nested checkout; and a tool that
   walks up to find the repo root mis-resolves the worktree's `.git` _file_ (a
   gitlink, not a directory) when it sits beneath the main checkout.
3. **The main checkout sits on the parent path of the worktree.** That makes
   "accidentally edit or commit in the main repo while meaning to work in the
   worktree" an easy fat-finger, since the main tree literally contains the
   worktree.

Crucially, the **engine was already location-agnostic by design**
([ADR 0040](0040-worktree-hooks-in-the-binary.md)): it discovers worktrees
through git's own registry (`git worktree list`, the admin dir
`<common>/.git/worktrees/<key>`) and derives identity from the git admin-dir
basename / `DISCERN_WORKTREE_ID` — never the checkout path. So the bad location
assumption was contained to the Claude-Code _feature_ layer (the create hook)
plus tests and docs, not the stack-neutral core.

## Decision

**Place worktrees in a configurable directory, defaulting to a sibling of the
repo.** For a repo at `/path/to/<repo>`, worktrees go in
`/path/to/<repo>.worktrees/<name>` — visible, adjacent, and outside the checkout
entirely.

- **New config key `[worktree].root`** — the directory under which per-worktree
  `<name>` checkouts are created:
  - empty / unset (the default) ⇒ the computed sibling above;
  - a **relative** path ⇒ resolved against the repo root (`.claude/worktrees`
    restores the old nesting for anyone who wants it; `../wts` a custom
    sibling);
  - an **absolute** path ⇒ used as-is.
- **One shared resolver.** `resolveWorktreeRoot(repoRoot, config)` lives in the
  feature layer ([`src/lib/paths.ts`](../../../src/lib/paths.ts)), never the
  engine. Every spawn path goes through it: the create hook builds
  `join(resolveWorktreeRoot(cwd, config), name)`, and `worktree prune` passes
  the resolved root as the orphan-sweep's `extraDirs` so a _fully_-orphaned root
  (no registered worktree left to derive its parent from) is still reclaimed.
  The dispatch layer — not `src/engine/**` — resolves and threads the root,
  preserving the ADR 0040 split: the engine knows no placement convention.
- **Flip the default immediately.** discern is pre-public (local dogfooding
  only), so the move is forward-only: new worktrees land in the sibling
  location, and **existing nested worktrees keep working** because the engine
  finds them via git regardless of where they sit. A schema-12→13 migration
  surfaces the documented `[worktree].root` key (empty ⇒ sibling) in an existing
  config; it changes no behaviour (empty already _is_ the new default) and never
  clobbers a hand-set value.

## Consequences

- **The pitfalls are gone.** The worktree is outside the repo, so no recursive
  tool double-counts it, no walk-up mis-resolves its `.git` file, and the main
  checkout is no longer the worktree's parent. `git status` in the main checkout
  stays clean the moment a worktree is created — without relying on a gitignore
  rule to hide it.
- **The gitignore no longer fences worktrees.**
  `templates/.gitignore.fragment`'s `/.claude/*` rule remains (it still covers
  the materialized `.claude/skills/`, and a project that opts back into
  `[worktree].root = ".claude/worktrees"`), but its stale "worktree checkouts"
  rationale is dropped.
- **The convention has exactly one home.** Placement is computed in
  `resolveWorktreeRoot` and nowhere else; the engine and its agent-agnosticism
  guard
  ([`tests/agent_agnostic_test.ts`](../../../tests/agent_agnostic_test.ts)) are
  untouched — the guard now also scans the shared engine-test harness so a test
  can't reintroduce the old `.claude/worktrees` assumption either.
- **"Restore the old nesting" is one config line.** A project that preferred the
  nested layout sets `root = ".claude/worktrees"`.
- **No data migration of existing worktrees.** A worktree created before the
  flip is found, landed with `accept`, and pruned exactly as before — git tracks
  it by its admin dir, not its path. (Moving the _repo_ would break a worktree's
  absolute `.git` link, but that is a pre-existing git property, unchanged
  here.)

## Alternatives considered

- **Keep nesting under `.claude/worktrees`.** Rejected: it is the source of all
  three pitfalls above, and the `.claude/` prefix is wrong for an agent-agnostic
  tool.
- **Nest under a generic `.discern/worktrees/` instead.** Drops the
  Claude-specificity but keeps the worktree _inside_ the repo, so the
  recursive-glob, `.git`-file-misresolution, and fat-finger problems all remain.
  Rejected in favour of a visible sibling.
- **Teach the engine the sibling convention directly.** Rejected: it would
  reintroduce a location assumption into the stack-neutral core that ADR 0040
  deliberately kept out. The engine keeps discovering worktrees from git; only
  the feature/dispatch layer knows where _new_ ones go.
- **Make the move opt-in and keep nesting the default.** Rejected: discern is
  pre-public and the nested default is known-bad, so carrying it forward only to
  spare a migration that isn't needed (the engine finds old worktrees
  regardless) trades a clean flip for lasting baggage.
