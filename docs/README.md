# discern documentation

The full documentation tree for discern. Audience is layered: each subtree's
`README.md` is for newcomers and visitors; the deeper leaves are for future-you
and the coding agents that ground their work in this codebase.

**This tree is the canonical source of truth for how the system fits together.**
It is written to describe **only what currently exists in code** — present
tense, no "will eventually". When a change alters something the docs describe,
the docs change with it. If a fact lives here and also in code, the code is
authoritative and the docs must not drift from it.

If you're new, start with [00-orientation/](00-orientation/) and follow the
trail.

---

## Browsing from the CLI

Two commands read a documentation tree, and they read **different** ones:

- **`discern help`** browses **discern's own documentation** — this tree —
  bundled into every install. Run it from any project that uses discern to read
  the [config reference](10-installer/config-reference.md), the concepts, or the
  gate/worktree/ratchet pages, without leaving the terminal: `discern help` for
  the index, `discern help config-reference` for one page, and `--list` /
  `--json` / `--raw` for scripted access. It always serves discern's **public**
  docs (never the host project's) and never shows the `_internal` / `_private`
  subtrees ([ADR 0039](_adr/0039-bundled-help-docs.md)). The ADRs are hidden by
  default but can be browsed with `discern help --adr` (CLI only — the MCP tool
  never exposes them).
- **`discern docs`** browses **the host project's map** — the agent-maintained
  documentation tree at `[docs].dir` (default `discern/docs/`, resolved from the
  project root; [ADR 0100](_adr/0100-doctree-is-the-agents-map.md)). This repo
  points `[docs].dir` at root `docs/` — here the project's docs _are_ the map, a
  deliberate, self-hosted exercise of the pointing escape hatch. It takes a
  one-call `--dir` override, and (unlike `help`) is refused before setup, since
  the project's tree is empty until setup seeds and fills it
  ([ADR 0080](_adr/0080-configured-agent-docs-root.md)).

Both share one implementation and the same surfaces: an interactive picker on a
TTY, and `--list` / `--json` / `--raw` / `--export` off one.

---

## Reading order

### Start here

| Path                               | What's in it                                                                                                                                                            |
| ---------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [00-orientation/](00-orientation/) | The shape of the system in plain English. Concepts, glossary, an ASCII system map, and the design principles. Read this once and the rest of the tree slots into place. |

### Subsystems

The subsystems are numbered subtrees, in the order a newcomer should read them.
Each currently holds a `README.md` tour; deeper leaves are filled
subtree-by-subtree with the
[`discern-document-subsystem`](../templates/skills/discern-document-subsystem/SKILL.md)
skill. The numbers are a reading order, not a contract — rename and renumber
freely.

| Path                                             | What's in it                                                                                                                                                                                                                                                                                                                                                                                                              |
| ------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [10-installer/](10-installer/)                   | The Deno/TypeScript **Installer**: `setup`, `doctor`, `config`, `preset`, the seed scaffolding (`templates/` → your files) and materialized skills, and the Schema-version Migration chain.                                                                                                                                                                                                                               |
| [20-quality-gate/](20-quality-gate/)             | `discern finish` and the Capability/Check execution model — fix · build · check · test — plus Scope classification (and Scope gates), Ratchets, and the [`improve`](20-quality-gate/improve.md) continuous-improvement coach.                                                                                                                                                                                             |
| [30-worktrees/](30-worktrees/)                   | The isolated-Worktree workflow: lifecycle (create · ensure · graduate · teardown · prune), per-Worktree identity (name · port · site · db · resource), and per-Worktree resources (create/destroy + orphan GC).                                                                                                                                                                                                           |
| [40-agent-guidance/](40-agent-guidance/)         | Author-once → compile-everywhere: the Guidance source, the `discern refresh` compiler, the Compiled agent files, and the bundled Skills.                                                                                                                                                                                                                                                                                  |
| [50-engine-internals/](50-engine-internals/)     | The TypeScript **engine** compiled into the binary — the verb dispatcher, the job runner, scope classification, config access, output, and the failure-pointer wording.                                                                                                                                                                                                                                                   |
| [60-agent-integrations/](60-agent-integrations/) | Provider-specific integration guides: the files discern writes for each supported coding agent, their trust gates, and their daily-use gotchas.                                                                                                                                                                                                                                                                           |
| [80-development/](80-development/)               | Working on discern: getting set up, the [notes for humans](80-development/for-humans.md) (IDE setup and local prerequisites), the testing approach, code conventions, the [install surface](80-development/install-surface.md) (what an install contains, yours vs the binary's), and the [finish-gate gotchas](80-development/finish-gate-gotchas.md) the quality gate points at when a step fails in a non-obvious way. |

### Reference material

| Path                     | What's in it                                                                                                                                                                                                                                                  |
| ------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [_adr/](_adr/)           | Architecture Decision Records — significant design decisions and their rationale, under continuous numbering. [`_adr/README.md`](_adr/README.md) is the canonical format. Embedded in the binary and browsable with `discern help --adr` (hidden by default). |
| [_internal/](_internal/) | The documenter brief and per-subtree scope manifests for writing and refreshing this tree. Methodology, not user-facing; kept for reproducibility (and seeded into every install's own tree).                                                                 |
| [_private/](_private/)   | discern-only material that never ships to users — the maintainer's notes, positioning, and research. Never embedded in a binary and never surfaced by `help`.                                                                                                 |

The three reference trees map onto how `discern help` curates them: the numbered
subtrees above are **public** (always shipped); `_adr/` is **internal but
opt-in** (shipped, revealed only by `--adr`); and `_internal/` and `_private/`
(and any other `_`-prefixed tree) are **private** — excluded from the binary and
the `help` view by default. The single allowlist of what ships is
`BUNDLED_INTERNAL_DOC_DIRS` in [`src/lib/paths.ts`](../src/lib/paths.ts), so a
new private tree is safe the moment it is created, with no list to remember (a
guard test pins this — `tests/docs_curation_test.ts`).

---

## How this tree is produced and kept current

The tree is seeded once by `discern setup` at `[docs].dir`, then grown
subtree-by-subtree with the
[`discern-document-subsystem`](../templates/skills/discern-document-subsystem/SKILL.md)
skill, which resolves the same configured root and follows the brief in
[_internal/documenter-agent-brief.md](_internal/documenter-agent-brief.md). A
single skeleton-and-orientation pass establishes the shared terminology and
shape before any subtree is filled in.

Because the tree is the source of truth, it must not drift from code. When you
change something a doc describes — the architecture, the data model, a
subsystem's documented behaviour, a public convention, or whether a feature
exists — update the affected docs in the same change.

---

## Conventions

- **File links** use relative paths from inside `docs/`:
  `[some module](../src/path/Thing.ext)`. Never a leading `docs/` from within
  `docs/`.
- **Terminology** follows the [glossary](00-orientation/glossary.md). The
  project's canonical nouns are defined there once; synonyms are not introduced.
- **No modal verbs about the system** ("should", "would", "could", "will
  eventually"). Every claim describes what exists in code today. Half-built or
  deprecated things live under a "Current state & gotchas" heading and are
  called out plainly.
- **Diagrams are ASCII-first**, so they live in the text and stay diffable. A
  richer rendered image is the exception, not the default.
- **Outstanding work does not live here.** The docs say what _is_; the root
  [`TODO.md`](../TODO.md) tracks what is _owed_.
