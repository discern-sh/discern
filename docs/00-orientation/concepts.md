# Concepts at a glance

A short narrative that connects the dots — the mental model of icculus in a few
minutes. For precise per-term definitions, jump to the [glossary](glossary.md).
For where each piece lives in code, follow the subsystem subtree READMEs.

> **Naming contract.** The canonical capitalised nouns defined in the
> [glossary](glossary.md) are used verbatim throughout this tree. Introduce them
> here, then use them — and only them — everywhere else. Do not invent synonyms.

---

## The one idea

**You declare what your project can do — format, lint, typecheck, test, build —
once.** icculus turns those declarations into the rails — a gate, isolated
worktrees, agent guidance — that every agent works within. The Engine never
learns your stack; it only runs your [Capabilities](glossary.md#capability).

Everything below fits in **four layers**:

1. **The gate — your definition of done:**
   [Capabilities](glossary.md#capability), [Scopes](glossary.md#scope),
   [Ratchets](glossary.md#ratchet).
2. **The workspace — isolated worktrees:** [Worktrees](glossary.md#worktree) and
   their [settings](glossary.md#worktree-settings).
3. **The agent surface — what agents read and run:**
   [Guidance](glossary.md#guidance-source) (always-on),
   [Skills](glossary.md#skill) (on-demand), [Recipes](glossary.md#recipe) (your
   `agent` verbs).
4. **The ownership model — who owns what:** [managed](glossary.md#managed-file)
   vs. **[yours](glossary.md#your-files--yours)**, with
   [Presets](glossary.md#preset) layering reusable stacks on top.

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
  the **Engine**, a `.icculus/config.toml` config, and bundled Skills. It is
  pure POSIX shell plus TOML, with no runtime dependency.

The pivot between them is [`templates/`](../../templates/), the **source of
truth**: every file a Harness contains originates there, and the Installer
copies, renders, merges, or appends it into place. That single rule — author in
`templates/`, generate the install — is what keeps a thousand installs
consistent and upgradable.

The Engine is deliberately **ignorant of your stack**. It runs "the test
Capability," "the fix-stage work," "the `gate` for this Scope" — names it
discovers from `.icculus/config.toml`, never commands it knows. A **Capability**
is one of five known things a project can do (`format` / `build` / `lint` /
`typecheck` / `test`); the Engine **derives the [Stage](glossary.md#stage)**
each runs in from its name, so you never write a scheduling keyword. Anything
outside those five is a **[Check](glossary.md#check)** with an explicit Stage.
Fill the Capabilities once and the generic Engine becomes your project's gate.

---

## How it works, end to end

**1. Install.** `icculus init` reads a few answers and the project brief, then
lays the Harness down from `templates/`: the `agent` dispatcher, the Engine, a
`.icculus/config.toml` with no Capabilities wired yet (a green gate you grow
into — an omitted capability is simply skipped), and a `.icculus/manifest.json`
recording a hash of every **Managed file**. Files split by **disposition** —
Managed (refreshed from the kit), [yours](glossary.md#your-files--yours)
(written once, then kept), Merged, Generated. The docs tree and `TODO.md` are
not scaffolded at install; the
[`bootstrap`](../../templates/.icculus/skills/bootstrap/SKILL.md) Skill writes
them on demand afterward.

**2. Fill in the stack.** The
[`bootstrap`](../../templates/.icculus/skills/bootstrap/SKILL.md) Skill — run by
the coding agent already in the loop — sniffs the repo and _proposes_ Capability
fills (formatter, linter, type-checker, tests) and writes the docs tree and
`TODO.md` from the brief. The Engine stays generic; only `.icculus/config.toml`
learns the stack.

**3. Work behind the gate.** Day to day, everything is driven through the
`agent` dispatcher:

- `agent worktree` carves an isolated **Worktree** (and branch) for a change, so
  the main checkout is never touched. Each Worktree gets its own database and
  dev-server port through the **Worktree settings** — empty until wired.
- `agent tidy` is the fast inner loop: the fix-stage Capabilities, then the
  check-stage ones.
- `agent finish` is the full **Gate**: fix and build, then check and test in
  parallel, then any **Scope** `gate`s that fired, then the main-merged check.
  Each Capability and **Check** runs as its own labelled job, so failure points
  at the exact one; `--json` makes that machine-readable.
- `agent worktree:exit` **graduates** the branch into the main repo and tears
  the Worktree down.

**4. Stay current.** As the kit evolves, `icculus upgrade` refreshes Managed
files **hash-aware**: pristine ones are overwritten, locally-edited ones
preserved with the new version dropped beside as `<file>.new`, your files left
untouched. When a release needs an install to change shape, a **Schema version**
bump runs an idempotent **Migration** chain before the file sync. This repo runs
this very loop on itself: `selfcheck` (a [Check](glossary.md#check)) fails the
Gate if the root install ever drifts from `templates/`.

Alongside the runtime path, guidance flows author-once → compile-everywhere: you
edit one **Guidance source** (`.icculus/guidelines/<slug>.md`) and
`agent guidelines` compiles it to each **Compiled agent file** (`CLAUDE.md`,
`AGENTS.md`), so several agents share one set of instructions.

---

## What to read next

| Want to understand...                                         | Go to                                                      |
| ------------------------------------------------------------- | ---------------------------------------------------------- |
| How an install is created, refreshed, and migrated            | [`../10-installer/`](../10-installer/)                     |
| `agent finish` — Capabilities, Checks, Scopes, Ratchets       | [`../20-quality-gate/`](../20-quality-gate/)               |
| The isolated-Worktree workflow and its settings seams         | [`../30-worktrees/`](../30-worktrees/)                     |
| Author-once → compile-everywhere guidance, and bundled Skills | [`../40-agent-guidance/`](../40-agent-guidance/)           |
| The `agent` dispatcher and the shared POSIX-shell library     | [`../50-engine-internals/`](../50-engine-internals/)       |
| The exact map of what an install contains (Managed vs yours)  | [install-surface.md](../80-development/install-surface.md) |
| Why the system is shaped this way                             | [design-principles.md](design-principles.md)               |
