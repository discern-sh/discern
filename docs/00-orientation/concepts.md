# Concepts at a glance

A short narrative that connects the dots — the mental model of icculus in a few
minutes. For precise per-term definitions, jump to the [glossary](glossary.md).
For where each piece lives in code, follow the subsystem subtree READMEs.

> **Naming contract.** The canonical capitalised nouns defined in the
> [glossary](glossary.md) are used verbatim throughout this tree. Introduce them
> here, then use them — and only them — everywhere else. Do not invent synonyms.

---

## The shape of the system

icculus turns **any repository** into one with a working agentic-development
harness — a quality gate, an isolated-worktree workflow, an author-once agent
guidance pipeline, and a docs discipline — installed in one command and
upgradable thereafter.

It has **two halves**:

- The **Installer** — a Deno/TypeScript CLI under [`src/`](../../src/). It
  _scaffolds_ a project (`init`), _refreshes_ it (`upgrade`), and checks it
  (`doctor`). It is a build-time tool that compiles to standalone binaries; an
  installed project never needs it again at runtime.
- The **Harness** — what an install contains and runs: the `agent` dispatcher,
  the **Engine**, an `icculus.toml` config, bundled Skills, and a docs scaffold.
  It is pure POSIX shell plus TOML, with no runtime dependency.

The pivot between them is [`templates/`](../../templates/), the **source of
truth**: every file a Harness contains originates there, and the Installer
copies, renders, merges, or appends it into place. That single rule — author in
`templates/`, generate the install — is what keeps a thousand installs
consistent and upgradable.

The Engine is deliberately **ignorant of your stack**. It runs "the test Slot,"
"the fix Slots," "the Side gate for this Scope" — names it discovers from
`icculus.toml`, never commands it knows. A **Slot** is one stack-specific
command tagged with a **Phase** (fix / build / check / test) that says when it
runs. Fill the Slots once and the generic Engine becomes your project's gate.

---

## How it works, end to end

**1. Install.** `icculus init` reads a few answers and the project brief, then
lays the Harness down from `templates/`: the `agent` dispatcher, the Engine, an
`icculus.toml` whose Slots are all `:` no-ops (a green gate you grow into), a
docs skeleton, and a `.icculus/manifest.json` recording a hash of every
**Managed file**. Files split by **disposition** — Managed (refreshed from the
kit), Seed (yours to keep), Merged, Generated.

**2. Fill in the stack.** The
[`bootstrap`](../../templates/.ai/skills/bootstrap/SKILL.md) Skill — run by the
coding agent already in the loop — sniffs the repo and _proposes_ Slot fills
(formatter, linter, type-checker, tests) and seeds the docs from the brief. The
Engine stays generic; only `icculus.toml` learns the stack.

**3. Work behind the gate.** Day to day, everything is driven through the
`agent` dispatcher:

- `agent worktree` carves an isolated **Worktree** (and branch) for a change, so
  the main checkout is never touched. Each Worktree gets its own database and
  dev-server port through the **Adapter** seams — empty until wired.
- `agent tidy` is the fast inner loop: the fix Slots, then the check Slots.
- `agent finish` is the full **Gate**: fix and build, then check and test in
  parallel, then any **Side gates** whose **Scope** changed, then the
  main-merged check. Each Slot runs as its own labelled job, so failure points
  at the exact Slot; `--json` makes that machine-readable.
- `agent worktree:exit` **graduates** the branch into the main repo and tears
  the Worktree down.

**4. Stay current.** As the kit evolves, `icculus upgrade` refreshes Managed
files **hash-aware**: pristine ones are overwritten, locally-edited ones
preserved with the new version dropped beside as `<file>.new`, Seeds left
untouched. When a release needs an install to change shape, a **Schema version**
bump runs an idempotent **Migration** chain before the file sync. This repo runs
this very loop on itself: `selfcheck` (a check Slot) fails the Gate if the root
install ever drifts from `templates/`.

Alongside the runtime path, guidance flows author-once → compile-everywhere: you
edit one **Guidance source** (`.ai/guidelines/<slug>.md`) and `agent guidelines`
compiles it to each **Compiled agent file** (`CLAUDE.md`, `AGENTS.md`), so
several agents share one set of instructions.

---

## What to read next

| Want to understand...                                         | Go to                                                      |
| ------------------------------------------------------------- | ---------------------------------------------------------- |
| How an install is created, refreshed, and migrated            | [`../10-installer/`](../10-installer/)                     |
| `agent finish` — Slots, Phases, Scopes, Side gates, Ratchets  | [`../20-quality-gate/`](../20-quality-gate/)               |
| The isolated-Worktree workflow and its Adapter seams          | [`../30-worktrees/`](../30-worktrees/)                     |
| Author-once → compile-everywhere guidance, and bundled Skills | [`../40-agent-guidance/`](../40-agent-guidance/)           |
| The `agent` dispatcher and the shared POSIX-shell library     | [`../50-engine-internals/`](../50-engine-internals/)       |
| The exact map of what an install contains (Managed vs Seed)   | [install-surface.md](../80-development/install-surface.md) |
| Why the system is shaped this way                             | [design-principles.md](design-principles.md)               |
