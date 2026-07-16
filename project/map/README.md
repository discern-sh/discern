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
  gate/worktree/standard pages, without leaving the terminal: `discern help` for
  the index, `discern help config-reference` for one page, and `--list` /
  `--json` / `--raw` for scripted access. It always serves discern's **public**
  docs (never the host project's) and never shows the `_internal` / `_private`
  subtrees ([ADR 0039](_adr/0039-bundled-help-docs.md)). Decision records do not
  ship in customer binaries: installed `help --adr` points to the public
  decisions archive and repository, while a source checkout keeps the local
  browse path for repo agents. The MCP tool serves the staged public set only
  ([ADR 0142](_adr/0142-customer-binaries-carry-only-public-docs.md)).
- **`discern map`** opens with an overview of **the host project's map** — the
  agent-maintained documentation tree at `[map].dir` (default `map/`, resolved
  from the project root) ([ADR 0120](_adr/0120-launch-verb-canon.md)). This repo
  points it at `project/map/`. The overview derives one line per public
  top-level subtree from its `README.md`. Beside it, Git reports when those
  pages last changed and how many later commits touched specific tracked files
  linked by the subtree's pages. Directory links do not expand into coverage. A
  subtree with no linked files or usable history says its freshness is unknown.
  It takes a one-call `--dir` override, and (unlike `help`) is refused before
  setup, since the project's tree is empty until setup seeds and fills it
  ([ADR 0080](_adr/0080-configured-agent-map-root.md)).

Both share one implementation and the same drill-in surfaces: an interactive
picker on a TTY, and `--list` / `--json` / `--raw` / `--export` off one. The
map's no-argument human view is the region overview; on a TTY the picker follows
it, while a pipe receives the overview alone. Its JSON index includes the same
`regions` digest. Each region carries `pages_changed_at` and
`code_changes_since` only when both facts are known; absence means unknown. It
carries no freshness verdict or linked-path list
([ADR 0127](_adr/0127-map-freshness-ships-file-facts.md)).

The global `--plain` flag makes every command use its static, non-paged form and
never prompt. An enabled `CI` environment or non-terminal stdin/stdout applies
the same interaction policy automatically. Read-only commands fall back to their
static report; a flow that needs a choice refuses and names the explicit flag or
alternative command to use.

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
[`discern-document-subsystem`](../../templates/skills/discern-document-subsystem/SKILL.md)
skill. The numbers are a reading order, not a contract — rename and renumber
freely.

| Path                                             | What's in it                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| ------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [10-installer/](10-installer/)                   | The Deno/TypeScript **Installer**: `setup`, `doctor`, `config`, `preset`, `uninstall`, the seed scaffolding (`templates/` → your files) and materialized skills, and the Schema-version Migration chain. New here? Start with the [walkthrough](10-installer/walkthrough.md), then [what discern writes](10-installer/what-discern-writes.md) and the [FAQ](10-installer/faq.md).                                                                                     |
| [20-quality-gate/](20-quality-gate/)             | `discern done` and the Capability/Check execution model — fix · build · check · test — plus Scope classification (and Scope gates), Standards, and the [`improvement`](20-quality-gate/improvement.md) continuous-improvement coach.                                                                                                                                                                                                                                  |
| [30-worktrees/](30-worktrees/)                   | The isolated-Worktree workflow: lifecycle (create · ensure · accept · teardown · prune), per-Worktree identity (name · port · site · db · resource), and per-Worktree resources (create/destroy + orphan GC).                                                                                                                                                                                                                                                         |
| [40-agent-guidance/](40-agent-guidance/)         | Author-once → compile-everywhere: the Guidance source, the `discern refresh` compiler, the Compiled agent files, and the bundled Skills.                                                                                                                                                                                                                                                                                                                              |
| [50-engine-internals/](50-engine-internals/)     | The TypeScript **engine** compiled into the binary — the verb dispatcher, the job runner, scope classification, config access, output, and the failure-pointer wording. Contributor-facing: not bundled into `discern help`.                                                                                                                                                                                                                                          |
| [60-agent-integrations/](60-agent-integrations/) | Provider-specific integration guides: the files discern writes for each supported coding agent, their trust gates, and their daily-use gotchas.                                                                                                                                                                                                                                                                                                                       |
| [80-development/](80-development/)               | Working on discern: getting set up, the [notes for humans](80-development/for-humans.md) (IDE setup and local prerequisites), the testing approach, code conventions, the [install surface](80-development/install-surface.md) (what an install contains, yours vs the binary's), and the [gate gotchas](80-development/done-gate-gotchas.md) the quality gate points at when a step fails in a non-obvious way. Contributor-facing: not bundled into `discern help`. |
| [90-site/](90-site/)                             | The public site (discern.sh): the editions under `site/pages/`, the fetch handler that serves them, reader negotiation (`curl` receives the plaintext DISCERN(1) edition), and [how to publish](90-site/publishing.md). Contributor-facing: not bundled into `discern help`.                                                                                                                                                                                          |

### Reference material

| Path                     | What's in it                                                                                                                                                                                                                                                         |
| ------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [_adr/](_adr/)           | Architecture Decision Records — significant design decisions and their rationale, under continuous numbering. [`_adr/README.md`](_adr/README.md) is the canonical format. Kept in the repo and published on the decisions site; never embedded in customer binaries. |
| [_internal/](_internal/) | The documenter brief and per-subtree scope manifests for writing and refreshing this tree. Methodology, not user-facing; kept for reproducibility (and seeded into every install's own tree).                                                                        |
| [_private/](_private/)   | discern-only material that never ships to users — the maintainer's notes, positioning, and research. Never embedded in a binary and never surfaced by `help`.                                                                                                        |

How `discern help` curates these trees: `BUNDLED_PUBLIC_DOC_DIRS` in
[`src/lib/paths.ts`](../../src/lib/paths.ts) admits the **user-relevant**
numbered subtrees, and `isPublicDoc` admits the published leaves inside them.
The **contributor** trees (`50-engine-internals/`, `80-development/`) and every
`_`-prefixed tree (`_adr/`, `_internal/`, `_private/`) are excluded from the
binary. A customer browsing `discern help` sees how to operate discern, not how
it is built or the maintainer's history. The build stages individual leaves, and
[`tests/map_curation_test.ts`](../../tests/map_curation_test.ts) pins the staged
set exactly to that two-axis public projection.

---

## How this tree is produced and kept current

The tree is seeded once by `discern setup` at `[map].dir`, then grown
subtree-by-subtree with the
[`discern-document-subsystem`](../../templates/skills/discern-document-subsystem/SKILL.md)
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

- **File links** use relative paths from inside `project/map/`:
  `[some module](../../src/path/Thing.ext)`. Never a leading `project/map/` from
  within the map.
- **Terminology** follows the [glossary](00-orientation/glossary.md). The
  project's canonical nouns are defined there once; synonyms are not introduced.
- **No modal verbs about the system** ("should", "would", "could", "will
  eventually"). Every claim describes what exists in code today. Half-built or
  deprecated things live under a "Current state & gotchas" heading and are
  called out plainly.
- **Diagrams are ASCII-first**, so they live in the text and stay diffable. A
  richer rendered image is the exception, not the default.
- **Outstanding work does not live here.** The docs say what _is_;
  [`project/TODO.md`](../TODO.md) tracks what is _owed_.
