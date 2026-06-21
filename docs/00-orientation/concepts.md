# Concepts at a glance

A short narrative that connects the dots — the mental model of discern in a few
minutes. For precise per-term definitions, jump to the [glossary](glossary.md).
For where each piece lives in code, follow the subsystem subtree READMEs.

> **Naming contract.** The canonical capitalised nouns defined in the
> [glossary](glossary.md) are used verbatim throughout this tree. Introduce them
> here, then use them — and only them — everywhere else. Do not invent synonyms.

---

## The one idea

**You declare what your project can do — format, lint, typecheck, test, build —
once.** discern turns those declarations into the rails — a gate, isolated
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
   own `discern` verbs).
4. **The ownership model — who owns what:**
   **[yours](glossary.md#your-files--yours)** (committed seeds) vs. **the
   [binary's](glossary.md#the-binarys-files)** (re-published artifacts), with
   [Presets](glossary.md#preset) layering reusable stacks on top.

---

## The shape of the system

discern turns **any repository** into one with a working agentic-development
harness — a quality gate, an isolated-worktree workflow, an author-once agent
guidance pipeline, and a docs discipline — installed in one command and
upgradable thereafter.

It is **one self-contained binary** with two faces:

- The **Installer** — the `discern init` / `upgrade` / `doctor` / `migrate` /
  `config` / `add-preset` verbs. They _scaffold_ a project, _refresh_ it, and
  check it. This face is build-time work: it writes a project's files, then
  steps out of the way.
- The **Engine** — the stack-neutral logic behind `discern finish` / `tidy` /
  `worktree` / … . It is **TypeScript compiled into the binary**
  ([`src/engine/`](../../src/engine/), sharing
  [`src/shared/`](../../src/shared/) with the Installer), not files installed
  into the project.

Both faces are the same `discern` command on `PATH`; an installed project
carries no engine of its own and needs no Deno at runtime. The seed files, the
built-in Skills, and the built-in guidance an install starts from are **bundled
into the binary** (their source lives under [`templates/`](../../templates/))
and written out by `init`/`upgrade` — there is no committed copy of the harness
to keep in sync. The whole discern footprint in a project is **one root file,
`discern.toml`** ([ADR 0020](../_adr/0020-dissolve-discern-dir.md)); everything
else you keep lives at open, config-pointed paths you choose.

The Engine is deliberately **ignorant of your stack**. It runs "the test
Capability," "the fix-stage work," "the `gate` for this Scope" — names it
discovers from `discern.toml`, never commands it knows. A **Capability** is one
of five known things a project can do (`format` / `build` / `lint` / `typecheck`
/ `test`); the Engine **derives the [Stage](glossary.md#stage)** each runs in
from its name, so you never write a scheduling keyword. Anything outside those
five is a **[Check](glossary.md#check)** with an explicit Stage. Fill the
Capabilities once and the generic Engine becomes your project's gate. A separate
`[features]` table toggles whole subsystems (worktrees, ratchets, guidance,
skills, docs) on or off — distinct from the Capabilities that wire the gate.

---

## How it works, end to end

**1. Install.** `discern init` reads a few answers and the project brief, then
lays down only _your_ seed files: a `discern.toml` with no Capabilities wired
yet (a green gate you grow into — an omitted capability is simply skipped), the
project `brief.md` (when non-empty), a merged `.claude/settings.json`, and an
appended `.gitignore` fragment. It then **materializes** the bundled Skills into
`.claude/skills/` (gitignored) and compiles the agent guidance. There is no
engine and no manifest to write — the Engine is in the binary. Files split by
**disposition**: [yours](glossary.md#your-files--yours) (the committed seeds,
written once then kept), [the binary's](glossary.md#the-binarys-files)
(gitignored artifacts it re-publishes, like the materialized Skills), plus the
Merged `settings.json`/`.gitignore`. The docs tree and `TODO.md` are not
scaffolded at install; the
[`bootstrap`](../../templates/skills/bootstrap/SKILL.md) Skill writes them on
demand afterward.

**2. Fill in the stack.** The
[`bootstrap`](../../templates/skills/bootstrap/SKILL.md) Skill — run by the
coding agent already in the loop — sniffs the repo and _proposes_ Capability
fills (formatter, linter, type-checker, tests), seeds a starter `guidance.md`,
and writes the docs tree and `TODO.md` from the brief. The Engine stays generic;
only `discern.toml` learns the stack.

**3. Work behind the gate.** Day to day, everything is driven through `discern`
verbs:

- `discern worktree` carves an isolated **Worktree** (and branch) for a change,
  so the main checkout is never touched. Each Worktree gets its own database and
  dev-server port through the **Worktree settings** — empty until wired.
- `discern tidy` is the fast inner loop: the fix-stage Capabilities, then the
  check-stage ones.
- `discern finish` is the full **Gate**: fix and build, then check and test in
  parallel, then any **Scope** `gate`s that fired, then the main-merged check.
  Each Capability and **Check** runs as its own labelled job, so failure points
  at the exact one; `--json` makes that machine-readable.
- `discern worktree:exit` **graduates** the branch into the main repo and tears
  the Worktree down.

**4. Stay current.** When you install a newer `discern` binary,
`discern
upgrade` brings the _project_ into line with it: it runs any pending
config-schema **Migration**s (the `5 → 6` step dissolved `.discern/` into the
single root `discern.toml`), re-materializes the Skills (always overwritten —
they are the binary's), recompiles the guidance, and re-stamps the **Schema
version** in `discern.toml`. Your seed files are left untouched. There is
nothing to hash and nothing to drift: the engine is in the binary, not on disk.
This repo proves the loop by running its _own_ engine straight from source —
`deno task dev
finish` — so the gate the maintainer runs is the gate that ships,
with no second copy to keep in sync.

Alongside the runtime path, guidance flows author-once → compile-everywhere:
discern's built-in harness guidance plus your **Guidance source** (`guidance.md`
by default) are compiled by `discern guidelines` into each **Compiled agent
file** (`AGENTS.md` tracked, `CLAUDE.md`/`GEMINI.md` gitignored), so several
agents share one set of instructions.

---

## What to read next

| Want to understand...                                         | Go to                                                      |
| ------------------------------------------------------------- | ---------------------------------------------------------- |
| How an install is created, refreshed, and migrated            | [`../10-installer/`](../10-installer/)                     |
| `discern finish` — Capabilities, Checks, Scopes, Ratchets     | [`../20-quality-gate/`](../20-quality-gate/)               |
| The isolated-Worktree workflow and its settings seams         | [`../30-worktrees/`](../30-worktrees/)                     |
| Author-once → compile-everywhere guidance, and bundled Skills | [`../40-agent-guidance/`](../40-agent-guidance/)           |
| The dispatcher and the TypeScript engine                      | [`../50-engine-internals/`](../50-engine-internals/)       |
| The exact map of what an install contains (yours vs binary's) | [install-surface.md](../80-development/install-surface.md) |
| Why the system is shaped this way                             | [design-principles.md](design-principles.md)               |
