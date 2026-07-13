# Concepts at a glance

A short narrative that connects the dots — the mental model of discern in a few
minutes. For precise per-term definitions, jump to the [glossary](glossary.md).
For where each piece lives in code, follow the subsystem subtree READMEs.

> **Naming contract.** The canonical capitalised nouns defined in the
> [glossary](glossary.md) are used verbatim throughout this tree. Introduce them
> here, then use them — and only them — everywhere else. Do not invent synonyms.

---

## The one idea

**You declare what your project can do — format, lint, typecheck, test, build,
smoke — once.** discern turns those declarations into the rails — a gate,
isolated worktrees, agent guidance — that every agent works within. The Engine
never learns your stack; it only runs your
[Capabilities](glossary.md#capability).

Everything below fits in **four layers**:

1. **The gate — your definition of done:**
   [Capabilities](glossary.md#capability), [Scopes](glossary.md#scope),
   [Standards](glossary.md#standard).
2. **The workspace — isolated worktrees:** [Worktrees](glossary.md#worktree) and
   their [settings](glossary.md#worktree-settings).
3. **The agent surface — what agents read and run:**
   [Guidance](glossary.md#guidance-source) (always-on),
   [Skills](glossary.md#skill) (on-demand),
   [Project Scripts](glossary.md#project-script) (your own `discern` verbs).
4. **The ownership model — who owns what:**
   **[yours](glossary.md#your-files--yours)** (committed seeds) vs. **the
   [binary's](glossary.md#the-binarys-files)** (re-published artifacts), with
   [Presets](glossary.md#preset) layering reusable stacks on top.

---

## The shape of the system

discern turns **any repository** into one with a working agentic-development
system — a quality gate, an isolated-worktree workflow, an author-once agent
guidance pipeline, and a docs discipline — installed in one command and
upgradable thereafter.

It is **one self-contained binary** with two faces:

- The **Installer** — the `discern setup` / `upgrade` / `doctor` / `upgrade` /
  `config` / `preset` verbs. They _scaffold_ a project, _refresh_ it, and check
  it. This face is build-time work: it writes a project's files, then steps out
  of the way.
- The **Engine** — the stack-neutral logic behind `discern done` / `prepare` /
  `improvement` / `worktree` / … . It is **TypeScript compiled into the binary**
  ([`src/engine/`](../../src/engine/), sharing
  [`src/shared/`](../../src/shared/) with the Installer), not files installed
  into the project.

Both faces are the same `discern` command on `PATH`; an installed project
carries no engine of its own and needs no Deno at runtime. The seed files, the
built-in Skills, and the built-in guidance an install starts from are **bundled
into the binary** (their source lives under [`templates/`](../../templates/))
and written out by `setup` — there is no committed copy of discern to keep in
sync. The committed discern footprint in a project is **one root file,
`discern.toml`, plus one visible folder, the
[`discern/` namespace](glossary.md#namespace)** — enforced by test
([ADR 0099](../_adr/0099-consolidate-authored-surface-under-discern-namespace.md));
every source the namespace defaults has a config key that points it at a path
you choose.

The Engine is deliberately **ignorant of your stack**. It runs "the test
Capability," "the fix-stage work," "the `gate` for this Scope" — names it
discovers from `discern.toml`, never commands it knows. A **Capability** is one
of six known things a project can do (`format` / `build` / `lint` / `typecheck`
/ `test` / `smoke`); the Engine **derives the [Stage](glossary.md#stage)** each
runs in from its name, so you never write a scheduling keyword. Anything outside
those five is a **[Check](glossary.md#check)** with an explicit Stage. Fill the
Capabilities once and the generic Engine becomes your project's gate. Every
subsystem is core — there is no toggle table
([ADR 0101](../_adr/0101-retire-the-features-toggles.md)): a subsystem you don't
use (worktrees you never start, standards you never define) is naturally inert.

---

## How it works, end to end

**1. Set up.** Setup is a short, staged handshake
([ADR 0075](../_adr/0075-setup-staged-handshake.md)) — never a wizard, and the
user makes no decisions at the CLI. Bare `discern` (or `discern setup`) prints a
read-only **welcome**: reassurance for the human, a funnel for their coding
agent. The agent then runs `discern setup verify` — a read-only preflight that
inspects the repo (git state, an existing `docs/` tree, existing agent
instructions, the agents on PATH, the worktree location) and **serves a
ready-to-relay _message to your human_** — the script, not stage directions
([ADR 0086](../_adr/0086-setup-serves-relay-messages-and-a-consent-attestation.md)):
what discern is, what it will do and cost, the model question, the docs
question, and the worktree location, for the agent to relay (adapting the
wording, never thinning the points). The docs question is consent, not
collision-avoidance: the [map](glossary.md#map) defaults to its own `map/`, and
the message asks whether discern should instead manage the project's existing
documentation — pointing `[map].dir` (via `begin --map`) is that explicit
consent ([ADR 0100](../_adr/0100-project-map-is-the-agents-map.md)); the
persisted `[map].dir` then drives every docs-aware surface
([ADR 0080](../_adr/0080-configured-agent-map-root.md)). **Nothing is written
until `discern setup begin`** — the first mutating step, which requires an
explicit `--confirmed` attestation that the consent conversation happened,
refusing and re-serving that message without it (outside the declarative
`--config` / `--allow-dirty` paths). It lays down only _your_ seed files with
zero-config defaults — a `discern.toml` with no Capabilities wired yet (a
bootstrap state: omitted individual capabilities are skipped, but `doctor` warns
while the gate has zero project checks), a merged `.claude/settings.json`, and a
co-managed `.gitignore` block. It then **materializes** the bundled Skills into
each configured agent's skills dir (gitignored) and compiles the agent guidance.
There is no engine and no manifest to write — the Engine is in the binary. Files
split by **disposition**: [yours](glossary.md#your-files--yours) (the committed
seeds, written once then kept), [the binary's](glossary.md#the-binarys-files)
(gitignored artifacts it re-publishes, like the materialized Skills), plus the
merged `settings.json` and co-managed `.gitignore` block. On a fresh install in
a clean repo, `begin` then **commits** discern's wiring — the `discern.toml`,
the `.gitignore` block, and the per-agent MCP + hooks files — as one
`discern: scaffold wiring` commit
([ADR 0076](../_adr/0076-engine-commits-scaffolded-machinery.md)), so the coding
agent never has to commit discern's own permission-widening config (its safety
classifier would refuse). `begin` then lays the [map](glossary.md#map) and
ledger skeletons at their configured paths (default `map/` and
`discern/TODO.md`, laid only when absent) — left uncommitted for the agent to
fill — and prints the operating principles plus the first **page** of the
authoring brief; the agent pulls each subsequent page with
`discern setup step
<n>`
([ADR 0078](../_adr/0078-setup-pages-and-per-step-proof.md)).

**2. Fill in the stack.** That brief — a structured page per step, served one at
a time — is what the coding agent already in the loop works through: it sniffs
the repo, asks the user a few clarifying questions, and _proposes_ Capability
fills (formatter, linter, type-checker, tests) **before any authoring** — the
gate goes green first, so a setup session interrupted midway leaves protection
behind rather than documentation without it — then seeds a starter guidance
source and fills the map and the ledger from the repo and those answers —
working transparently throughout: recommending each change, saying why it helps
and that `discern` is what will enforce it, committing each stage on its own so
the user can review or revert, and pausing only for genuine decisions rather
than gating every step ([ADR 0044](../_adr/0044-setup-involve-not-gate.md)). The
Engine stays generic; only `discern.toml` learns the stack. Setup finishes with
`discern setup done`, which re-derives from repo state that each step's
authoring actually landed — so a skipped step can't pass
([ADR 0078](../_adr/0078-setup-pages-and-per-step-proof.md)) — requires that
authoring committed (the proof and the landing story operate on commits), and
proves the gate green (refresh → doctor → done, then a throwaway-worktree probe)
before recording completion. Its completion output then does three things: it
reports an **honest coverage summary** — each standard capability marked
_enforced_, _deferred_, or _absent_, plus an overall verdict — so "the gate is
proven" never reads as "every protection runs" when, say, no test suite is
wired; it names **where the work lives** (on the `discern-setup` branch, not yet
on `main`) and the one command to land it, `discern setup accept`
([ADR 0081](../_adr/0081-setup-accept-command.md)); and it reminds the agent to
start a fresh session (the wired MCP tools and session hooks load only at
session start) and to deepen the setup with `discern improvement`.

**3. Work behind the gate.** Day to day, everything is driven through `discern`
verbs:

- `discern status` is the read-only orient-first verb: _what's true right now
  and what to do next_ — the branch, how far it sits from the integration
  branch, what changed, and what the gate _would_ fire (it never runs anything).
  From a **Worktree** it shows that Worktree's own state; from the main checkout
  it surveys the whole fleet of Worktrees in flight. It rounds out the trio with
  `discern doctor` (_is it correctly installed?_) and `discern improvement`
  (_what should get better next?_).
- `discern start` carves an isolated **Worktree** (and branch) for a change, so
  the main checkout is never touched. Each Worktree gets its own dev-server port
  and any per-worktree **resources** (a database, an emulator, …) a project
  declares through the **Worktree settings** — none until wired.
- `discern prepare` is the fast inner loop: the fix-stage Capabilities, then the
  check-stage ones.
- `discern done` is the full **Gate**: the main-merged check first (in a
  Worktree) as a fail-fast precondition, then fix and build, then check and test
  in parallel, then any **Scope** `gate`s that fired. Each Capability and
  **Check** runs as its own labelled job, so failure points at the exact one;
  `--json` makes that machine-readable.
- `discern update` brings the latest **main** into the Worktree's branch and
  re-materializes the agent files + Skills in one step — what the Gate's
  fail-fast merge check points a behind branch at, and the deterministic inverse
  of accept.
- `discern accept` **accepts** the branch into the main repo and tears the
  Worktree down.
- Bare `discern` — no verb, in a terminal — opens **the desk**, the human's own
  surface: a decision-ordered picker over the fleet that lands, updates,
  inspects, or drops an effort interactively
  ([the desk](../30-worktrees/the-desk.md)). Agents and pipes get help, exactly
  as before; the verbs above stay the machine surface.

**4. Stay current.** When you install a newer `discern` binary,
`discern
upgrade` brings the _project_ into line with it: it runs any pending
config-schema **Migration**s (the `5 → 6` step dissolved `.discern/` into the
single root `discern.toml`), re-materializes the Skills (always overwritten —
they are the binary's), restores any missing fixed `discern.toml` scaffold
sections/keys from the current template, recompiles the guidance, and re-stamps
the **Schema version** in `discern.toml`. Project-owned values and named config
tables are left alone. There is nothing to hash and nothing to drift in the
engine itself: it is in the binary, not on disk. This repo proves the loop by
running its _own_ engine straight from source — `discern done`, where `discern`
runs the engine of the checkout you are in — so the gate the maintainer runs is
the gate that ships, with no second copy to keep in sync.

Alongside the runtime path, guidance flows author-once → compile-everywhere:
discern's built-in guidance plus your **Guidance source** (`discern/guidance.md`
by default) are compiled by `discern refresh` into each **Compiled agent file**
(`AGENTS.md`, `CLAUDE.md`, `GEMINI.md` — committed generated files, drift
guarded by the currency check), so several agents share one set of instructions
and a bare clone hands cloud agents the same page.

---

## What to read next

| Want to understand…                                           | Go to                                                      |
| ------------------------------------------------------------- | ---------------------------------------------------------- |
| How an install is created, refreshed, and migrated            | [`../10-installer/`](../10-installer/)                     |
| `discern done` — Capabilities, Checks, Scopes, Standards      | [`../20-quality-gate/`](../20-quality-gate/)               |
| The isolated-Worktree workflow and its settings seams         | [`../30-worktrees/`](../30-worktrees/)                     |
| Author-once → compile-everywhere guidance, and bundled Skills | [`../40-agent-guidance/`](../40-agent-guidance/)           |
| The dispatcher and the TypeScript engine                      | [`../50-engine-internals/`](../50-engine-internals/)       |
| The exact map of what an install contains (yours vs binary's) | [install-surface.md](../80-development/install-surface.md) |
| Why the system is shaped this way                             | [design-principles.md](design-principles.md)               |
