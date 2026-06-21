# ADR 0023: Rename and promote the workflow commands

**Status**: accepted

## Context

With the harness renamed to discern ([ADR 0022](0022-rename-to-discern.md)),
three run-time verbs no longer read as well as the public CLI deserves:

- **`tidy`** is the fast inner loop (the fix stage, then the read-only checks).
  "Tidy" reads as an optional cleanup, not as the thing you run _before_ the
  full gate. The mental model is "get the change ready, then prove it done."
- **`worktree:exit`** graduates a worktree's branch back to the main checkout
  for review. It is one of the most frequent actions in the workflow, yet it was
  buried in the `worktree:` namespace beside the rarely-typed plumbing
  (`teardown`, `prune`, `ensure`) — and "exit" undersells it (you are not
  exiting, you are promoting finished work).
- **`guidelines`** compiles the agent files _and_ materializes skills, and is
  meant to grow into a broader "regenerate the generated agent/integration
  surface" command. "Guidelines" names only one of its jobs and boxes it in.

The window is the same one ADR 0022 used: pre-release, one self-hosting
consumer, no published binaries. Renaming verbs is cheapest now.

## Decision

**Rename the three verbs — and promote one out of its namespace — as a hard
rename with no aliases.**

- **`tidy` → `prepare`.** Behaviour is unchanged: run the fix-stage commands,
  then the check-stage commands; never build or test. The name states intent —
  `discern prepare` readies a change; `discern finish` proves it done.
- **`worktree:exit` → `graduate` (promoted to top-level).** Behaviour, safety
  checks, and reporting are unchanged. It moves from the `worktree:` group to a
  first-class `discern graduate`, because graduating finished work for review is
  a primary action in the workflow, not worktree plumbing. The lower-level
  worktree management stays namespaced (`worktree:teardown`, `worktree:prune`,
  `worktree:ensure`, bare `worktree`, `worktree-name`).
- **`guidelines` → `refresh`.** Behaviour is unchanged _for now_ (compile the
  built-in guidance plus `[guidance].sources` into the agent files, and
  materialize/link the effective skill set). The broader name leaves room to
  refresh a wider integration surface later. The `[guidance]` config section and
  the guidance-compilation model are deliberately **not** renamed — this is a
  command and user-facing-language change, not a model change.
- **Hard rename, no shim.** The binary recognises only the new verbs; the old
  ones are gone (the same reasoning as [ADR 0022](0022-rename-to-discern.md): no
  install base to support, and an alias is the dual-spelling debt the
  single-source-of-truth discipline exists to avoid).

The canonical workflow now reads:

```
discern init
/bootstrap
discern prepare    # fast inner loop: fixers + checks, no build/test
discern finish     # full definition-of-done gate
discern graduate   # graduate the isolated worktree branch back for review
discern refresh    # refresh generated agent files, skills, integration artifacts
```

## Consequences

- Internal symbols followed the user-facing rename **where they named the
  command**: `runTidy` → `runPrepare` (and `gate/tidy.ts` → `gate/prepare.ts`),
  and `worktreeExit` → `graduate`. The guidance compiler kept its name
  (`compileGuidelines`, `guidelines.ts`, `GuidelinesResult`) because it is bound
  to the unchanged `[guidance]` model, not to the old command spelling — only
  its user-facing strings (the generated-file banner, the run summary) now say
  `refresh`.
- The promotion changed the command surface: the `worktree` group no longer
  lists `exit`, and `graduate` is a top-level verb gated on the `worktrees`
  feature. The engine smoke test asserts the promotion (top-level `graduate`,
  group still surfacing its colon sub-verbs).
- **No migration step ships.** The rename touches verbs, not the config schema,
  so `[meta].schema_version` is unchanged. A downstream project adapts by
  getting the new binary and updating its own references; the worktree git hooks
  call `worktree` / `worktree:ensure` / `worktree:teardown` — none renamed — so
  hooks are unaffected.
- Historical ADRs keep their point-in-time verb names (e.g. an ADR describing
  the cutover-era `tidy`/`guidelines`); this ADR is the record of the change,
  exactly as [ADR 0022](0022-rename-to-discern.md) handled the project rename.

## Alternatives considered

- **Keep aliases for the old verbs.** Rejected: pre-release there is nothing to
  keep compatible, and a permanent alias for every verb is the dual-spelling
  debt ADR 0022 already argued against.
- **Leave `worktree:exit` namespaced (rename only).** Rejected: graduating is a
  primary, frequent action; keeping it beside the plumbing kept underselling the
  common path. Promotion makes "finish, then graduate" read as the workflow it
  is.
- **Rename the `[guidance]` model and `compileGuidelines` too.** Rejected for
  now: the command broadens, but the guidance model is stable and the compiler
  is a cross-module contract; churning it would cost more than it teaches.
  `refresh` can absorb more jobs without the model changing.
