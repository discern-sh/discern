---
title: Compile and check instructions
description: Run refresh, inspect the agent files, and keep every configured agent on the current sources.
order: 20
aliases:
  - refresh instructions
  - agent files
  - generated instructions
---

# Compile and check agent instructions

_After an instruction edit, run `discern refresh`, review the generated files, and commit the tracked outputs with their sources._

## Refresh the agent files

From the project root, run:

```sh
discern refresh --dry-run
discern refresh
discern status
```

`refresh` compiles built-in and `[instructions].sources` text, then reconciles skills, integrations, and the maintained architecture decision record (ADR) index.

`--dry-run` lists the planned targets for agent files, merge attributes, integrations, materialized skills, the ADR index, and Proof-note Git config, plus any planning errors, without writing. Refresh creates or updates agent files but never removes one. Command-line interface (CLI) JSON/Markdown and Model Context Protocol (MCP) `discern_refresh` expose the same plan. Apply consumes it; `status` and the gate use its tracked projection ([ADR 0335](../_adr/0335-operation-policy-enrolls-faithful-previews.md)).

For each full-body output, local Markdown destinations are rewritten to resolve to the same project target they had beside their source. The parser limits edits to destination bytes; external, root-absolute, fragment-only, and code-like text stays unchanged. Provider pointers remain registry-defined.

The renderer gives every full body and pointer one final line feed; writers and currency checks consume those bytes.

The ADR index is opt-in by construction: a README that carries the `BEGIN GENERATED` markers is maintained, one without them is never touched. Fresh installs receive the markers from the setup skeleton; an existing project adopts the index by adding them. A README that a `[generated.<name>]` group owns is never touched either. `adrIndexState` reports it as absent, so refresh, status, the gate, and update's conflict policy leave it to that generator ([ADR 0424](../_adr/0424-generator-owned-paths-have-one-writer.md)).

The built-in map section also derives a compact region list from the configured map ([ADR 0174](../_adr/0174-agent-document-discovery-funnel.md)). Each non-internal top-level directory contributes its region target and front-door title. Adding or renaming a region, or changing its front-door title, changes the agent files. Other changes within an existing region leave that list unchanged. Run `discern refresh` after either kind of source change; the currency check reports whether the tracked outputs changed.

`discern prepare` runs the complete refresh after fix and `[generated]` jobs, before checks. Green means provider files and skills are current; partial materialization is red with a `discern refresh` reproduction.

The configured agent set decides which instruction files refresh writes and the gate checks:

| Agent integration | File the agent reads |
| ----------------- | -------------------- |
| Claude Code       | `CLAUDE.md`          |
| Codex             | `AGENTS.md`          |
| Gemini            | `GEMINI.md`          |
| Cursor            | `AGENTS.md`          |
| GitHub Copilot    | `AGENTS.md`          |

`AGENTS.md` holds the canonical compiled body when an integration reads it. Claude Code and Gemini use their own files, which can point to that canonical body. Cursor and GitHub Copilot read `AGENTS.md` directly. The provider registry owns these mappings, so adding an integration updates every consumer from one record. Removing an integration from `[project].agents` leaves its files in place, and the gate stops checking them. Today only `discern uninstall` removes them.

## Keep sources and outputs together

discern generates agent files, and Git tracks them by default. A bare clone then contains the current instructions before it can run `discern refresh` ([ADR 0128](../_adr/0128-enumerated-ownership-tracked-guidance.md)). Review and commit the source edit and generated files in the same change.

Do not edit a compiled file to fix its prose. The next refresh replaces that edit, and the gate's currency check reports the drift. Edit the configured source, then refresh again.

`discern done` runs the same currency check before the slower gate stages. A mismatch stops the gate early and names the generated files that need refreshing ([ADR 0034](../_adr/0034-agents-md-untracked-currency-check.md)).

## Lines no source produces

Agent files stay whole-file generated outputs, so a refresh replaces every line no source produced. `agentFileDiscard` in [`instruction_render.ts`](../../../src/engine/instruction_render.ts) names those lines for the gate, status, and every refresh. It aligns the file with its recompiled body and sorts each lost line by where it stands:

- **An edit** replaces lines the compile wrote, as a hand edit, a reflowing formatter, a stale source, or discern's own changed output does. The gate's remedy stays `discern refresh`.
- **An added line** stands where the compiled body has nothing, as when another tool keeps its own block in the file. A file that keeps none of the compiled text, such as one another tool wrote whole, counts as added throughout. Here the gate's diagnostic and hint, and the status hint, offer the owner three choices: move lines they wrote into an instruction source; have the tool write into a file listed in `[instructions].sources`, declared under `[generated.<name>]` with the tool's regenerate command; or refresh and discard them.

A line whose text survives elsewhere in the recompiled body, or in another agent file the same compile writes, counts as moved, never lost. The comparison ignores Markdown link destinations, because the compile rewrites them.

### Every overwrite reports what it discards

A refresh exists to replace edits, so only added lines count as discarded. The refresh planner attaches the comparison's verdict to each agent-file write, and `applyRefreshPlan`, which applies every such write, records each file that lost added lines. Each path that overwrites agent files carries that report to its caller:

| Path                                                         | Report                                                                                                                            |
| ------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------- |
| `discern refresh`                                            | `data.agent_files_discarded` (path, count, first lines) and a notice hint. A dry run lists the planned discards without the hint. |
| `discern prepare`                                            | The notice, plus a warning diagnostic whose output keeps every discarded line.                                                    |
| `discern start`, `discern update`, `discern worktree ensure` | The notice hint.                                                                                                                  |
| `discern upgrade`, `discern setup begin`, `discern accept`   | The notice hint. For `accept`, the lines are missing from what landed.                                                            |
| `discern setup done`                                         | A refusal at the refresh stage that names the files, plus the notice.                                                             |

`prepare` warns instead of refusing. It is the inner loop: it converges agent files so `done` finds nothing left to rewrite, and the owner, not the loop, decides where added lines belong. The warning's retained output keeps every discarded line even when no commit held them, so the loss stays recoverable.

[`agent_file_writers.ts`](../../../tests/agent_file_writers.ts) enrolls every call site that renders agent-file bytes or runs the writer, and each declares how its caller learns of a discard. Only the refresh planner may turn rendered bytes into writes. A new path fails the gate until it is declared ([`agent_file_writers_guard_test.ts`](../../../tests/agent_file_writers_guard_test.ts)).

## Check each agent-copy source at its authority

Operational procedures derive from the skill resolver and setup templates. A repository-only registry binds exact prose but never renders. Tests reject escaped metadata and apply generated `DiscernAgent` rules ([ADR 0267](../_adr/0267-operational-contracts-stay-outside-agent-copy.md)).

## Current state & gotchas

- An explicit empty `[project].agents` list emits no instruction files.
- discern generates a provider-specific pointer only when its canonical target exists. Otherwise that provider receives the full compiled body.
- Git ignores materialized Skills and tracks agent files unless your own `.gitignore` rules say otherwise.
- A successful `discern update` or `discern accept` refreshes its resulting checkout. After an ordinary source edit, run `discern refresh` directly or let `discern prepare` converge it before the Gate.

## Where it lives in code

| Concern                         | Source                                                                                                                   |
| ------------------------------- | ------------------------------------------------------------------------------------------------------------------------ |
| Refresh plan and apply          | [`tracked_refresh.ts`](../../../src/engine/tracked_refresh.ts), [`instructions.ts`](../../../src/engine/instructions.ts) |
| Canonical and pointer rendering | [`instruction_render.ts`](../../../src/engine/instruction_render.ts)                                                     |
| Local Markdown link relocation  | [`markdown_links.ts`](../../../src/lib/markdown_links.ts)                                                                |
| Lost-line alignment             | [`line_hunks.ts`](../../../src/lib/line_hunks.ts)                                                                        |
| Region discovery                | [`docs.ts`](../../../src/lib/docs.ts)                                                                                    |
| Agent file mappings             | [`providers.ts`](../../../src/lib/providers.ts)                                                                          |
| Operational-copy universe       | [`agent_surface_contracts.ts`](../../../scripts/agent_surface_contracts.ts)                                              |
| Operational-copy guard          | [`agent_surface_contracts_test.ts`](../../../tests/agent_surface_contracts_test.ts)                                      |
| Maintained ADR index            | [`adr_index.ts`](../../../src/lib/adr_index.ts)                                                                          |
| Refresh behavior                | [`engine_refresh_test.ts`](../../../tests/engine_refresh_test.ts)                                                        |
| Preparation convergence         | [`prepare.ts`](../../../src/engine/gate/prepare.ts)                                                                      |
| ADR index behavior              | [`engine_adr_index_test.ts`](../../../tests/engine_adr_index_test.ts)                                                    |
