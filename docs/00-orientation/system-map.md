# System map

Bird's-eye view of how discern fits together. Read this once and the rest of the
documentation tree should slot into place.

---

## The system, end to end

One self-contained binary, `discern`, on `PATH`. Its **Installer** verbs write a
project's seed files (and materialize the bundled Skills); its **Engine** verbs
— TypeScript compiled into the same binary — run the gate and the worktree
workflow. No engine is installed into the project; nothing it writes needs a
runtime.

### Build / install axis — how an install comes to exist

```
┌──────────────────────────────┐   bundles    ┌──────────────────────────┐
│   the `discern` binary       │ ◄─────────── │       templates/         │
│  Installer verbs + Engine    │  (compiled   │  seed · skill · guidance │
│  (one self-contained binary) │   in)        │  sources (bundled in)    │
└──────────────┬───────────────┘              └──────────────────────────┘
       │  discern setup / upgrade
       │  write seeds · merge · reconcile .gitignore · materialize skills · compile guidance
       ▼
┌────────────────────────────────────────────────────────────┐
│                   An install — on disk                      │
│  discern.toml — the one root file (no engine, no manifest)  │
│  + discern/ — the visible namespace, 100% yours:            │
│      guidance.md · docs/ (the map) · TODO.md ·              │
│      skills/ · recipes/ · brief.md (each config-pointable)  │
│  + generated: AGENTS.md, CLAUDE.md/GEMINI.md,               │
│      .claude/skills/, .agents/skills/ (gitignored)          │
│  + merged provider settings, co-managed .gitignore          │
└────────────────────────────────────────────────────────────┘
```

### Run-time axis — what happens when you run a verb

```
person / coding agent
       │  discern <verb>
       ▼
┌──────────────────────┐  known verb  ┌─────────────────────────────┐
│   discern binary     │ ───────────► │   Engine handler (in-binary) │
│  dispatch.ts:        │              │  done · prepare · worktree   │
│  root + verb routing │              │  ratchets · refresh · …      │
└──────────┬───────────┘              └──────────────┬──────────────┘
           │ unknown verb                            │  reads commands from
           ▼                                         ▼
┌──────────────────────────────┐        ┌──────────────────────────────┐
│  project Recipe (exec'd)     │        │        discern.toml           │
│  discern/recipes/<verb>      │        │  Capabilities · Checks ·      │
│  with DISCERN_* exported     │ ─────► │  Scopes (+ gates) · Ratchets  │
│  (built-in verb wins)        │ reads  │  · Worktree settings          │
└──────────────────────────────┘  via   └──────────────────────────────┘
                                 discern config get
```

`discern done` walks the Stages in order, attributing each job to one Capability
or Check:

```
  fix  ───►  build  ───►  check ∥ test  ───►  scope gates  ───►  main-merged
(serial,   (parallel    (parallel,        (only Scopes      (only in a
 mutating)  w/ fix)      read-only+suite)   that changed)     Worktree)
```

The Worktree workflow brackets a change, keeping the main checkout untouched:

```
main checkout ──discern start──► Worktree ⟲ discern update
      ▲                                  │     (pull main in + re-materialize)
      └─────────────── discern accept ─┘     accept branch + tear down
```

---

## Where each piece runs

- **The Installer is build-time work, not a service.** The `setup`/`upgrade`/
  `doctor` verbs run, write or refresh a project's files, and exit. They are
  **absent from an installed project's runtime** — once a project is set up,
  nothing the Installer did is a runtime dependency.
- **The whole tool is one self-contained binary.** The Engine is TypeScript
  compiled into it; a verb spawns a process that runs and is gone when the
  command returns. There is **no daemon and no server** — work happens
  synchronously when you run `discern <verb>`. An install carries no engine of
  its own.
- **Concurrency is in-process fan-out, not a queue.** Inside `done`, the
  parallel Stages run their Capabilities and Checks as concurrent child
  processes via the Engine's job runner
  ([`src/engine/jobs/runner.ts`](../../src/engine/jobs/runner.ts)), collected
  before the Stage returns. Fail-fast cancellation tree-kills the running
  siblings via Deno's process-group kill
  ([`command.ts`](../../src/engine/jobs/command.ts)).
- **Persistent state lives in the repo.** `discern.toml` (the hand-edited
  config, which also carries `[meta].schema_version`) and the git repo itself
  (branches, and linked Worktrees in a sibling `<repo>.worktrees/` by default —
  configurable via `[worktree].root`). No manifest, no database, no external
  state.
- **The only hard external dependency is `git`.** A project's own stack tools
  (the formatter, linter, test runner named as Capabilities) are invoked by
  those Capabilities, not bundled — the Engine shells out to whatever the
  project already has.

---

## How the map relates to the subtrees

| Region of the map                                          | Documented in                                              |
| ---------------------------------------------------------- | ---------------------------------------------------------- |
| `src/` Installer verbs, the seed writes, schema migrations | [`../10-installer/`](../10-installer/)                     |
| `discern done`, the Stage walk, Scopes, Scope gates        | [`../20-quality-gate/`](../20-quality-gate/)               |
| The Worktree bracket and its per-worktree resources        | [`../30-worktrees/`](../30-worktrees/)                     |
| Guidance source → Compiled agent files, bundled Skills     | [`../40-agent-guidance/`](../40-agent-guidance/)           |
| Verb dispatch and the TypeScript engine                    | [`../50-engine-internals/`](../50-engine-internals/)       |
| Provider-specific coding-agent config                      | [`../60-agent-integrations/`](../60-agent-integrations/)   |
| The install surface — yours vs the binary's                | [install-surface.md](../80-development/install-surface.md) |
