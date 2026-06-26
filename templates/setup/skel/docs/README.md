# {{project_name}} documentation

The full documentation tree for {{project_name}}. Audience is layered: each subtree's `README.md` is for newcomers and visitors; the deeper leaves are for future-you and the coding agents that ground their work in this codebase.

**This tree is the canonical source of truth for how the system fits together.** It is written to describe **only what currently exists in code** — present tense, no "will eventually". When a change alters something the docs describe, the docs change with it. If a fact lives here and also in code, the code is authoritative and the docs must not drift from it.

If you're new, start with [00-orientation/](00-orientation/) and follow the trail.

> This tree starts as a skeleton. Run the `discern setup` command to have your coding agent seed it from the repo and a few questions it asks you. The markers below (`<!-- setup fills this -->`) show what is still a placeholder.

---

## Reading order

### Start here

| Path | What's in it |
|---|---|
| [00-orientation/](00-orientation/) | The shape of the system in plain English. Concepts, glossary, an ASCII system map, and the design principles. Read this once and the rest of the tree slots into place. |

### Subsystems

<!-- setup fills this -->

The subsystems are numbered subtrees, in the order a newcomer should read them — `10-…` through `80-…`. Each has a `README.md` tour plus deeper leaves. `discern setup` proposes the subtree names from the repo's shape; until then, only the placeholders below exist. Rename and renumber freely — the numbers are a reading order, not a contract.

| Path | What's in it |
|---|---|
| `10-<subsystem>/` | _Proposed during `discern setup`._ |
| `20-<subsystem>/` | _Proposed during `discern setup`._ |
| `…` | _Add as many numbered subtrees as the system needs._ |
| [80-development/](80-development/) | Working on {{project_name}}: getting set up, the testing approach, code conventions, and the [finish-gate gotchas](80-development/finish-gate-gotchas.md) the quality gate points at when a step fails in a non-obvious way. |

### Reference material

| Path | What's in it |
|---|---|
| [_adr/](_adr/) | Architecture Decision Records — significant design decisions and their rationale, under continuous numbering. [`_adr/README.md`](_adr/README.md) is the canonical format. |
| [_internal/](_internal/) | The documenter brief and per-subtree scope manifests for writing and refreshing this tree. Not part of the user-facing docs; kept for reproducibility. |

---

## How this tree is produced and kept current

The tree is seeded once by `discern setup`, then grown subtree-by-subtree with the [`document-subsystem`](../.claude/skills/document-subsystem/SKILL.md) skill, which follows the brief in [_internal/documenter-agent-brief.md](_internal/documenter-agent-brief.md). A single skeleton-and-orientation pass establishes the shared terminology and shape before any subtree is filled in.

Because the tree is the source of truth, it must not drift from code. When you change something a doc describes — the architecture, the data model, a subsystem's documented behaviour, a public convention, or whether a feature exists — update the affected docs in the same change.

---

## Conventions

- **File links** use relative paths from inside `docs/`: `[some module](../src/path/Thing.ext)`. Never a leading `docs/` from within `docs/`.
- **Terminology** follows the [glossary](00-orientation/glossary.md). The project's canonical nouns are defined there once; synonyms are not introduced.
- **No modal verbs about the system** ("should", "would", "could", "will eventually"). Every claim describes what exists in code today. Half-built or deprecated things live under a "Current state & gotchas" heading and are called out plainly.
- **Diagrams are ASCII-first**, so they live in the text and stay diffable. A richer rendered image is the exception, not the default.
- **Outstanding work does not live here.** The docs say what *is*; the root [`TODO.md`](../TODO.md) tracks what is *owed*.
