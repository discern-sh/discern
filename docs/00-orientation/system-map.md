# System map

Bird's-eye view of how icculus fits together. Read this once and the rest of the
documentation tree should slot into place.

---

## The system, end to end

One self-contained binary, `icculus`, on `PATH`. Its **Installer** verbs write a
project's seed files (and materialize the bundled Skills); its **Engine** verbs
— TypeScript compiled into the same binary — run the gate and the worktree
workflow. No engine is installed into the project; nothing it writes needs a
runtime.

### Build / install axis — how an install comes to exist

```
┌──────────────────────────────┐   bundles    ┌──────────────────────────┐
│   the `icculus` binary       │ ◄─────────── │       templates/         │
│  Installer verbs + Engine    │  (compiled   │  seed + skill sources    │
│  (one self-contained binary) │   in)        │  (bundled into binary)   │
└──────────────┬───────────────┘              └──────────────────────────┘
       │  icculus init / upgrade
       │  write seeds · merge · append · materialize skills
       ▼
┌────────────────────────────────────────────────────────────┐
│                   An install — on disk                      │
│  the `.icculus/` namespace (no engine, no manifest):        │
│  config.toml · guidelines/ · brief.md · recipes/  (yours)   │
│  skills/  (the binary's — gitignored)                       │
│  + merged .claude/settings.json, appended .gitignore        │
│  (docs/ + TODO.md arrive later, via /bootstrap)             │
└────────────────────────────────────────────────────────────┘
```

### Run-time axis — what happens when you run a verb

```
person / coding agent
       │  icculus <verb>
       ▼
┌──────────────────────┐  known verb  ┌─────────────────────────────┐
│   icculus binary     │ ───────────► │   Engine handler (in-binary) │
│  dispatch.ts:        │              │  finish · tidy · worktree ·  │
│  root + verb routing │              │  ratchets · guidelines · …   │
└──────────┬───────────┘              └──────────────┬──────────────┘
           │ unknown verb                            │  reads commands from
           ▼                                         ▼
┌──────────────────────────────┐        ┌──────────────────────────────┐
│  project Recipe (exec'd)     │        │     .icculus/config.toml      │
│  .icculus/recipes/<verb>     │        │  Capabilities · Checks ·      │
│  with ICCULUS_* exported     │ ─────► │  Scopes (+ gates) · Ratchets ·│
│  (built-in verb wins)        │ reads  │  Worktree settings            │
└──────────────────────────────┘  via   └──────────────────────────────┘
                                 icculus config get
```

`icculus finish` walks the Stages in order, attributing each job to one
Capability or Check:

```
  fix  ───►  build  ───►  check ∥ test  ───►  scope gates  ───►  main-merged
(serial,   (parallel    (parallel,        (only Scopes      (only in a
 mutating)  w/ fix)      read-only+suite)   that changed)     Worktree)
```

The Worktree workflow brackets a change, keeping the main checkout untouched:

```
main checkout ──icculus worktree──► Worktree  (branch + own db + own port)
      ▲                                  │
      └────────── icculus worktree:exit ─┘   graduate branch + tear down
```

---

## Where each piece runs

- **The Installer is build-time work, not a service.** The `init`/`upgrade`/
  `doctor` verbs run, write or refresh a project's files, and exit. They are
  **absent from an installed project's runtime** — once a project is set up,
  nothing the Installer did is a runtime dependency.
- **The whole tool is one self-contained binary.** The Engine is TypeScript
  compiled into it; a verb spawns a process that runs and is gone when the
  command returns. There is **no daemon and no server** — work happens
  synchronously when you run `icculus <verb>`. An install carries no engine of
  its own.
- **Concurrency is in-process fan-out, not a queue.** Inside `finish`, the
  parallel Stages run their Capabilities and Checks as concurrent child
  processes via the Engine's job runner
  ([`src/engine/jobs/runner.ts`](../../src/engine/jobs/runner.ts)), collected
  before the Stage returns. Fail-fast cancellation tree-kills the running
  siblings via Deno's process-group kill
  ([`command.ts`](../../src/engine/jobs/command.ts)).
- **Persistent state lives in the repo.** `.icculus/config.toml` (hand-edited
  config, which also carries `[meta].schema_version`) and the git repo itself
  (branches and linked Worktrees under `.claude/worktrees/`). No manifest, no
  database, no external state.
- **The only hard external dependency is `git`.** A project's own stack tools
  (the formatter, linter, test runner named as Capabilities) are invoked by
  those Capabilities, not bundled — the Engine shells out to whatever the
  project already has.

---

## How the map relates to the subtrees

| Region of the map                                           | Documented in                                              |
| ----------------------------------------------------------- | ---------------------------------------------------------- |
| `src/` Installer verbs, the seed writes, schema migrations  | [`../10-installer/`](../10-installer/)                     |
| `icculus finish`, the Stage walk, Scopes, Scope gates       | [`../20-quality-gate/`](../20-quality-gate/)               |
| The Worktree bracket and its database / dev-server settings | [`../30-worktrees/`](../30-worktrees/)                     |
| Guidance source → Compiled agent files, bundled Skills      | [`../40-agent-guidance/`](../40-agent-guidance/)           |
| Verb dispatch and the TypeScript engine                     | [`../50-engine-internals/`](../50-engine-internals/)       |
| The install surface — yours vs the binary's                 | [install-surface.md](../80-development/install-surface.md) |
