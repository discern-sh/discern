---
title: System map
description: The architecture as one picture — how the binary, an install, and the run-time verbs relate.
order: 50
aliases:
  - architecture
  - system map
  - diagram
---

# System map

_The architecture as one picture: the binary, what an install looks like on disk, and what happens when a verb runs._

One self-contained binary, `discern`, on `PATH`. Its installer verbs write a project's seed files; its engine verbs, compiled into the same binary, run the gate and the worktree workflow. Nothing it writes needs a runtime.

## How an install comes to exist

```
┌──────────────────────────────┐   bundles    ┌──────────────────────────┐
│   the `discern` binary       │ ◄─────────── │   bundled sources        │
│  installer verbs + engine    │  (compiled   │  seeds · skills ·        │
│  (one self-contained binary) │   in)        │  built-in guidance       │
└──────────────┬───────────────┘              └──────────────────────────┘
       │  discern setup / upgrade
       │  write seeds · merge · reconcile .gitignore · materialize skills · compile guidance
       ▼
┌────────────────────────────────────────────────────────────┐
│                   An install — on disk                      │
│  discern.toml — one root file (no engine, no manifest)      │
│  + discern/ — the visible namespace, 100% yours:            │
│      guidance.md · TODO.md ·                                │
│      skills/ · scripts/ · brief.md (each config-pointable)  │
│  + map/ — the documentation map                             │
│  + generated: AGENTS.md, CLAUDE.md/GEMINI.md,               │
│      .claude/skills/, .agents/skills/ (gitignored)          │
│  + merged provider settings, co-managed .gitignore          │
└────────────────────────────────────────────────────────────┘
```

## What happens when you run a verb

```
person / coding agent
       │  discern <verb>
       ▼
┌──────────────────────┐  known verb  ┌─────────────────────────────┐
│   discern binary     │ ───────────► │  engine handler (in-binary)  │
│  verb router:        │              │  done · prepare · worktree   │
│  root + verb routing │              │  standards · refresh · …      │
└──────────┬───────────┘              └──────────────┬──────────────┘
           │ discern script <name>                   │  reads commands from
           ▼                                         ▼
┌──────────────────────────────┐        ┌──────────────────────────────┐
│  project script (exec'd)     │        │        discern.toml           │
│  discern/scripts/<name>      │        │  capabilities · checks ·      │
│  with DISCERN_* exported     │ ─────► │  scopes (+ gates) · standards  │
│  (built-in names are legal)  │ reads  │  · worktree settings          │
└──────────────────────────────┘  via   └──────────────────────────────┘
                                 discern config get
```

`discern done` walks the stages in order, attributing each job to one capability or check:

```
  fix  ───►  build  ───►  check ∥ test  ───►  scope gates  ───►  main-merged
(serial,   (parallel    (parallel,        (only scopes      (only in a
 mutating)  w/ fix)      read-only+suite)   that changed)     worktree)
```

The worktree workflow brackets a change, keeping the main checkout untouched:

```
main checkout ──discern start──► worktree ⟲ discern update
      ▲                                  │     (pull main in + re-materialize)
      └─────────────── discern accept ─┘     accept branch + tear down
```

## What the picture implies

- **No daemon, no server.** A verb spawns a process that runs and is gone when the command returns; work happens synchronously when you run `discern <verb>`.
- **Persistent state lives in the repo.** `discern.toml` plus the git repository itself: branches, and linked worktrees in a sibling `<repo>.worktrees/` folder by default (configurable via `[worktree].root`). No manifest, no database, no external state.
- **The only hard external dependency is `git`.** Your stack's own tools (the formatter, linter, test runner named as capabilities) are invoked by those capabilities; discern bundles none of them.
- **Concurrency is in-process.** Inside `done`, the parallel stages run their jobs as concurrent child processes, collected before the stage returns; the first failure cancels its running siblings (see [the quality gate](../20-quality-gate/)).
