# {{project_name}} — the map

The agent-maintained map of {{project_name}}: how the system fits together, inferred from the code and written by the coding agents that work here. Agents read it to ground their work and keep it current as the code changes; humans read it to orient — and to audit what their agents actually understand about the codebase.

**The map is the canonical account of how the system fits together.** It describes **only what currently exists in code** — present tense, no "will eventually". When a change alters something the map describes, the map changes with it; a stale map is a defect. If a fact lives here and also in code, the code is authoritative and the map must not drift from it.

If you're new, start with [00-orientation/](00-orientation/) and follow the trail.

> The map starts as a skeleton. Run the `discern setup` command to have your coding agent seed it from the repo and a few questions it asks you. The markers below (`<!-- setup fills this -->`) show what is still a placeholder.

---

## Reading order

### Start here

| Path                               | What's in it                                                                                                                                                            |
| ---------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [00-orientation/](00-orientation/) | The shape of the system in plain English. Concepts, glossary, an ASCII system map, and the design principles. Read this once and the rest of the tree slots into place. |

### Subsystems

<!-- setup fills this -->

The subsystems are numbered subtrees, in the order a newcomer should read them — `10-…` through `80-…`. Each has a `README.md` tour plus deeper leaves. `discern setup` proposes the subtree names from the repo's shape; until then, only the placeholders below exist. Rename and renumber freely — the numbers are a reading order, not a contract.

| Path                               | What's in it                                                                                                                                                                                                        |
| ---------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `10-<subsystem>/`                  | _Proposed during `discern setup`._                                                                                                                                                                                  |
| `20-<subsystem>/`                  | _Proposed during `discern setup`._                                                                                                                                                                                  |
| `…`                                | _Add as many numbered subtrees as the system needs._                                                                                                                                                                |
| [80-development/](80-development/) | Working on {{project_name}}: getting set up, the testing approach, code conventions, and the [gate gotchas](80-development/done-gate-gotchas.md) the quality gate points at when a step fails in a non-obvious way. |

### Reference material

| Path           | What's in it                                                                                                                                                                                                               |
| -------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [_adr/](_adr/) | Architecture Decision Records — significant design decisions and their rationale, under continuous numbering. [`_adr/README.md`](_adr/README.md) is the canonical format.                                                  |
| `_internal/`   | Seeded by `discern setup` — the documenter brief and per-subtree scope manifests the `discern-document-subsystem` skill writes and refreshes this tree from. Not part of the user-facing docs; kept for reproducibility. |

---

## How the map is produced and kept current

The map is seeded once by `discern setup` — the `_internal/` documenter brief included — then grown subtree-by-subtree with the `discern-document-subsystem` skill, which follows that brief at `_internal/documenter-agent-brief.md`. A single skeleton-and-orientation pass establishes the shared terminology and shape before any subtree is filled in.

Because the map is the canonical account, it must not drift from code. When you change something a doc describes — the architecture, the data model, a subsystem's documented behaviour, a public convention, or whether a feature exists — update the affected docs in the same change.

---

## Conventions

- **File links** use relative paths from inside this tree: `[some module](../src/path/Thing.ext)`. Never a leading `{{map_dir}}` from within the tree.
- **Terminology** follows the [glossary](00-orientation/glossary.md). The project's canonical nouns are defined there once; synonyms are not introduced.
- **No modal verbs about the system** ("should", "would", "could", "will eventually"). Every claim describes what exists in code today. Half-built or deprecated things live under a "Current state & gotchas" heading and are called out plainly.
- **Diagrams are ASCII-first**, so they live in the text and stay diffable. A richer rendered image is the exception, not the default.
- **Outstanding work does not live here.** The map says what _is_; the deferred-work ledger at `{{todo_path}}` tracks what is _owed_.
