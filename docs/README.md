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

## Reading order

### Start here

| Path                               | What's in it                                                                                                                                                            |
| ---------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [00-orientation/](00-orientation/) | The shape of the system in plain English. Concepts, glossary, an ASCII system map, and the design principles. Read this once and the rest of the tree slots into place. |

### Subsystems

The subsystems are numbered subtrees, in the order a newcomer should read them.
Each currently holds a `README.md` tour; deeper leaves are filled
subtree-by-subtree with the
[`document-subsystem`](../templates/skills/document-subsystem/SKILL.md) skill.
The numbers are a reading order, not a contract — rename and renumber freely.

| Path                                         | What's in it                                                                                                                                                                                                                                                                                                                                                                                                              |
| -------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [10-installer/](10-installer/)               | The Deno/TypeScript **Installer**: `init`, `upgrade`, `doctor`, `migrate`, `config`, `add-preset`, the seed scaffolding (`templates/` → your files) and materialized skills, and the Schema-version Migration chain.                                                                                                                                                                                                      |
| [20-quality-gate/](20-quality-gate/)         | `discern finish` and the Capability/Check execution model — fix · build · check · test — plus Scope classification (and Scope gates), Ratchets, and the [`audit`](20-quality-gate/audit.md) best-practices checklist.                                                                                                                                                                                                     |
| [30-worktrees/](30-worktrees/)               | The isolated-Worktree workflow: lifecycle (create · ensure · graduate · teardown · prune), per-Worktree identity (name · port · site · db · resource), and per-Worktree resources (create/destroy + orphan GC).                                                                                                                                                                                                           |
| [40-agent-guidance/](40-agent-guidance/)     | Author-once → compile-everywhere: the Guidance source, the `discern refresh` compiler, the Compiled agent files, and the bundled Skills.                                                                                                                                                                                                                                                                                  |
| [50-engine-internals/](50-engine-internals/) | The TypeScript **engine** compiled into the binary — the verb dispatcher, the job runner, scope classification, config access, output, and the failure-pointer wording.                                                                                                                                                                                                                                                   |
| [80-development/](80-development/)           | Working on discern: getting set up, the [notes for humans](80-development/for-humans.md) (IDE setup and local prerequisites), the testing approach, code conventions, the [install surface](80-development/install-surface.md) (what an install contains, yours vs the binary's), and the [finish-gate gotchas](80-development/finish-gate-gotchas.md) the quality gate points at when a step fails in a non-obvious way. |

### Reference material

| Path                         | What's in it                                                                                                                                                              |
| ---------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [_adr/](_adr/)               | Architecture Decision Records — significant design decisions and their rationale, under continuous numbering. [`_adr/README.md`](_adr/README.md) is the canonical format. |
| [_internal/](_internal/)     | The documenter brief and per-subtree scope manifests used to write and refresh this tree. Not part of the user-facing docs; kept for reproducibility.                     |
| [_maintainer/](_maintainer/) | The project maintainer's notes, thoughts, and ideas. Not part of the user-facing docs.                                                                                    |

---

## How this tree is produced and kept current

The tree is seeded once by `discern bootstrap`, then grown subtree-by-subtree
with the [`document-subsystem`](../templates/skills/document-subsystem/SKILL.md)
skill, which follows the brief in
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
