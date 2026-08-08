---
title: System map
description: "The architecture as one picture: how the binary, an install, and the run-time verbs relate."
order: 50
aliases:
  - architecture
  - system map
  - diagram
---

# System map

_The architecture in one picture: the binary, an install on disk, and what happens when a verb runs._

One self-contained binary, `discern`, runs from `PATH`. Its installer verbs write a project's seed files. Its engine verbs, compiled into the same binary, run the project's final quality check (the Gate) and the worktree workflow. The files it writes require no discern runtime.

## How an install comes to exist

```
┌──────────────────────────────┐   bundles    ┌──────────────────────────┐
│   the `discern` binary       │ ◄─────────── │   bundled sources        │
│  installer verbs + engine    │  (compiled   │  seeds · skills ·        │
│  (one self-contained binary) │   in)        │  built-in guidance       │
└──────┬───────────────────────┘              └──────────────────────────┘
       │  discern setup / upgrade
       │  write seeds · merge · reconcile .gitignore · materialize skills · compile guidance
       ▼
┌────────────────────────────────────────────────────────────┐
│                    An install: on disk                     │
│  discern.toml: one root file (no engine, no manifest)      │
│  + discern/: the visible, project-owned namespace:         │
│      guidance.md · TODO.md ·                               │
│      skills/ · scripts/ · brief.md (each config-pointable) │
│  + map/ — the documentation map                            │
│  + agent files (tracked): AGENTS.md · CLAUDE.md/GEMINI.md  │
│  + materialized Skills: .claude/skills/, .agents/skills/   │
│      (gitignored)                                          │
│  + merged provider settings, shared .gitignore             │
└────────────────────────────────────────────────────────────┘
```

## What happens when you run a verb

```
person / coding agent
       │  discern <verb>
       ▼
┌──────────────────────┐  known verb  ┌──────────────────────────────┐
│   discern binary     │ ───────────► │  engine handler (in-binary)  │
│  verb router:        │              │  done · prepare · worktree   │
│  root + verb routing │              │  standards · refresh · …     │
└──────────┬───────────┘              └──────────────┬───────────────┘
           │ discern scripts <name>                  │  reads commands from
           ▼                                         ▼
┌──────────────────────────────┐        ┌──────────────────────────────┐
│  project script (executed)   │        │         discern.toml         │
│  discern/scripts/<name>      │        │  jobs · scopes (+ gates) ·   │
│  with DISCERN_* exported     │ ─────► │  standards · worktree        │
│  (built-in names are legal)  │  reads │  settings                    │
└──────────────────────────────┘   via  └──────────────────────────────┘
                                discern config get
```

`discern done` checks the worktree's trunk precondition, then walks the declared jobs through their stages:

```
trunk-merged  ───►  fix  ───►  build  ───►  check ∥ test  ───►  scope gates
(worktree       (serial,   (parallel    (parallel,          (only scopes
 precondition)   mutating)  w/ fix)      read-only+suite)     that changed)
```

The worktree workflow brackets a change, keeping the main checkout untouched:

```
main checkout ──discern start──►  worktree  ⟲  discern update
      ▲                              │          (pull main in + re-materialize)
      └────── discern accept ────────┘          accept branch + tear down
```

## What the picture implies

- **No daemon, no server.** A verb starts a process that exits when the command returns. Work happens when you run `discern <verb>`.
- **Persistent state lives in the repo.** `discern.toml` plus the git repository itself: branches, and linked worktrees in a sibling `<repo>.worktrees/` folder by default (configurable via `[worktree].root`). No manifest, no database, no external state.
- **The engine's required external tool is `git`.** Your stack supplies the formatter, linter, and test runner invoked as jobs. discern embeds `discern tidy` for the Map, guidance, TODO, and root config whose conventions discern owns.
- **Concurrency is in-process.** During `done`, parallel stages run jobs as child processes and collect them before the stage returns. The first failure cancels its running siblings (see [the quality gate](../20-quality-gate/)).
