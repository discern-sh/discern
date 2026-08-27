---
id: understand-index
title: "Understand"
description: "Choose the mental model that resolves a product-state or authority question."
order: 0
publish: true
kind: explanation
aliases:
  - "understand-index"
  - "system map"
  - "architecture"
  - "diagram"
---

# Understand

Choose the mental model that resolves a product-state or authority question.

## In this section

- [Practice and roles](practice-and-roles.md): Understand discern as a project-installed practice, the coding agent as operator, and the human as owner and reviewer.
- [Proof](proof.md): Distinguish green, exact-tree Proof, declared conclusions, review, landing authority, landed state, and later release.
- [Checkpoints](checkpoints.md): Understand triggered judgment, met/unmet declarations, drops, and the owner's separate variance decision.
- [Standards](standards.md): Understand Standards as one-way retained gains, including why a passing number is not an arbitrary quality score.
- [Worktrees and trunk](worktrees-and-trunk.md): Understand why unfinished work stays in isolated worktrees, what trunk means, and how update/composition/accept move evidence.
- [Instructions skills and map](instructions-skills-and-map.md): Distinguish always-loaded project rules, focused Skills, the project's existing human docs, and inspectable agent Map understanding.
- [Local control](local-control.md): Understand local evidence, network/model boundaries, write authority, and what discern does not secure or decide.
- [Evidence and improvement](evidence-and-improvement.md): Understand what local patterns and validation findings can support, and where comparison stops short of causation or ranking.

## System map

_The architecture in one picture: the binary, an install on disk, and what happens when a verb runs._

One self-contained binary, `discern`, runs from `PATH`. Its installer verbs write a project's seed files. Its engine verbs, compiled into the same binary, run the project's final quality check (the Gate) and the worktree workflow. The files it writes require no discern runtime.

### How an install comes to exist

```
┌──────────────────────────────┐   bundles    ┌──────────────────────────┐
│   the `discern` binary       │ ◄─────────── │   bundled sources        │
│  installer verbs + engine    │  (compiled   │  seeds · skills ·        │
│  (one self-contained binary) │   in)        │  built-in instructions   │
└──────┬───────────────────────┘              └──────────────────────────┘
       │  discern setup / upgrade
       │  write seeds · merge · reconcile .gitignore · materialize skills · compile instructions
       ▼
┌────────────────────────────────────────────────────────────┐
│                    An install: on disk                     │
│  discern.toml: one root file (no engine, no manifest)      │
│  + discern/: the visible, project-owned namespace:         │
│      instructions.md · TODO.md ·                           │
│      skills/ · scripts/ · brief.md (each config-pointable) │
│  + map/ — the documentation map                            │
│  + agent files (tracked): AGENTS.md · CLAUDE.md/GEMINI.md  │
│  + materialized Skills: .claude/skills/, .agents/skills/   │
│      (gitignored)                                          │
│  + merged provider settings, shared .gitignore             │
└────────────────────────────────────────────────────────────┘
```

### What happens when you run a verb

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

### What the picture implies

- **No daemon, no server.** A verb starts a process that exits when the command returns. Work happens when you run `discern <verb>`.
- **Persistent state lives in the repo.** `discern.toml` plus the git repository itself: branches, and linked worktrees in a sibling `<repo>.worktrees/` folder by default (configurable via `[worktree].root`). No manifest, no database, no external state.
- **The engine's required external tool is `git`.** Your stack supplies the formatter, linter, and test runner invoked as jobs. discern embeds `discern tidy` for the Map, instructions, TODO, and root config whose conventions discern owns.
- **Concurrency is in-process.** During `done`, parallel stages run jobs as child processes and collect them before the stage returns. The first failure cancels its running siblings (see [the quality gate](../10-guides/README.md)).
