# System map

Bird's-eye view of how icculus fits together. Read this once and the rest of the
documentation tree should slot into place.

---

## The system, end to end

Two halves meet at `templates/`. The **Installer** (under `src/`) reads
`templates/` — the source of truth — and writes a **Harness** into a project.
From then on the Harness runs on its own, in pure POSIX shell.

### Build / install axis — how a Harness comes to exist

```
┌──────────────┐   reads    ┌──────────────────────────┐
│   src/       │ ─────────► │       templates/         │
│  Installer   │            │  (source of truth for    │
│  (Deno CLI)  │            │   everything installed)  │
└──────┬───────┘            └──────────────────────────┘
       │  icculus init / upgrade
       │  copy · render · merge · append  — by disposition
       ▼
┌────────────────────────────────────────────────────────────┐
│                   An install — the Harness                  │
│  bin/agent  ·  .icculus/engine/  ·  icculus.toml            │
│  .ai/guidelines/  ·  .ai/skills/  ·  docs/  ·  manifest.json │
└────────────────────────────────────────────────────────────┘
```

### Run-time axis — what happens inside an install

```
person / coding agent
       │  agent <verb>
       ▼
┌──────────────┐   routes to    ┌─────────────────────────────┐
│  bin/agent   │ ─────────────► │   .icculus/engine/  Recipe   │
│ (dispatcher) │                │  finish · tidy · worktree ·  │
└──────────────┘                │  doctor · guidelines · …     │
                                └──────────────┬──────────────┘
                                               │  reads commands from
                                               ▼
                                ┌─────────────────────────────┐
                                │         icculus.toml         │
                                │  Slots (by Phase) · Scopes · │
                                │  Side gates · Ratchets ·     │
                                │  Worktree Adapters           │
                                └─────────────────────────────┘
```

`agent finish` walks the Phases in order, attributing each job to one Slot:

```
  fix  ───►  build  ───►  check ∥ test  ───►  side gates  ───►  main-merged
(serial,   (parallel    (parallel,        (only Scopes      (only in a
 mutating)  w/ fix)      read-only+suite)   that changed)     Worktree)
```

The Worktree workflow brackets a change, keeping the main checkout untouched:

```
main checkout ──agent worktree──► Worktree  (branch + own db + own port)
      ▲                                │
      └─────────── agent worktree:exit ┘   graduate branch + tear down
```

---

## Where each piece runs

- **The Installer is a build-time CLI**, not a service. It runs as a Deno
  process during `init`/`upgrade`/`doctor` and compiles to standalone binaries
  in `dist/`. It is **absent from an installed project** — nothing it provides
  is a runtime dependency.
- **The Harness is files plus short-lived shell processes.** `bin/agent` and
  each Engine Recipe are `#!/usr/bin/env sh` programs spawned per invocation and
  gone when the command returns. There is **no daemon and no server** — work
  happens synchronously when you run `agent <verb>`.
- **Concurrency is in-process fan-out, not a queue.** Inside `finish`, the
  parallel Phases run their Slots as concurrent background `sh` jobs via the
  Engine's job runner (`lib/jobs.sh`), collected before the Phase returns.
- **Persistent state lives in the repo.** `icculus.toml` (hand-edited config),
  `.icculus/manifest.json` (generated hashes + Kit/Schema versions), the git
  repo itself (branches and linked Worktrees under `.claude/worktrees/`), and
  the optional `.icculus/evidence/` store. No database, no external state.
- **The only hard external dependency is `git`.** A project's own stack tools
  (the formatter, linter, test runner named in Slots) are invoked by the Slots,
  not bundled — the Engine shells out to whatever the project already has.

---

## How the map relates to the subtrees

| Region of the map                                           | Documented in                                              |
| ----------------------------------------------------------- | ---------------------------------------------------------- |
| `src/` Installer, the disposition copy, the Manifest        | [`../10-installer/`](../10-installer/)                     |
| `agent finish`, the Phase walk, Scopes, Side gates          | [`../20-quality-gate/`](../20-quality-gate/)               |
| The Worktree bracket and its database / dev-server Adapters | [`../30-worktrees/`](../30-worktrees/)                     |
| Guidance source → Compiled agent files, bundled Skills      | [`../40-agent-guidance/`](../40-agent-guidance/)           |
| `bin/agent` dispatch and the `lib/` shell library           | [`../50-engine-internals/`](../50-engine-internals/)       |
| `templates/` ↔ install surface (Managed vs Seed)            | [install-surface.md](../80-development/install-surface.md) |
