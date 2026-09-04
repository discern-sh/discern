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

`--dry-run` lists create, update, and removal targets for agent files, merge attributes, integrations, materialized skills, the ADR index, Proof-note Git config, and planning errors without writing. Command-line interface (CLI) JSON/Markdown and Model Context Protocol (MCP) `discern_refresh` expose the same plan. Apply consumes it; `status` and the gate use its tracked projection ([ADR 0335](../_adr/0335-operation-policy-enrolls-faithful-previews.md)).

For each full-body output, local Markdown destinations are rewritten to resolve to the same project target they had beside their source. The parser limits edits to destination bytes; external, root-absolute, fragment-only, and code-like text stays unchanged. Provider pointers remain registry-defined.

The renderer gives every full body and pointer one final line feed; writers and currency checks consume those bytes.

The ADR index is opt-in by construction: a README that carries the `BEGIN GENERATED` markers is maintained, one without them is never touched. Fresh installs receive the markers from the setup skeleton; an existing project adopts the index by adding them.

The built-in map section also derives a compact region list from the configured map ([ADR 0174](../_adr/0174-agent-document-discovery-funnel.md)). Each non-internal top-level directory contributes its region target and front-door title. Adding or renaming a region, or changing its front-door title, changes the agent files. Other changes within an existing region leave that list unchanged. Run `discern refresh` after either kind of source change; the currency check reports whether the tracked outputs changed.

`discern prepare` runs the complete refresh after fix and `[generated]` jobs, before checks. Green means provider files and skills are current; partial materialization is red with a `discern refresh` reproduction.

The configured agent set decides which instruction files exist:

| Agent integration | File the agent reads |
| ----------------- | -------------------- |
| Claude Code       | `CLAUDE.md`          |
| Codex             | `AGENTS.md`          |
| Gemini            | `GEMINI.md`          |
| Cursor            | `AGENTS.md`          |
| GitHub Copilot    | `AGENTS.md`          |

`AGENTS.md` holds the canonical compiled body when an integration reads it. Claude Code and Gemini use their own files, which can point to that canonical body. Cursor and GitHub Copilot read `AGENTS.md` directly. The provider registry owns these mappings, so adding an integration updates every consumer from one record.

## Keep sources and outputs together

discern generates agent files, and Git tracks them by default. A bare clone then contains the current instructions before it can run `discern refresh` ([ADR 0128](../_adr/0128-enumerated-ownership-tracked-guidance.md)). Review and commit the source edit and generated files in the same change.

Do not edit a compiled file to fix its prose. The next refresh replaces that edit, and the gate's currency check reports the drift. Edit the configured source, then refresh again.

`discern done` runs the same currency check before the slower gate stages. A mismatch stops the gate early and names the generated files that need refreshing ([ADR 0034](../_adr/0034-agents-md-untracked-currency-check.md)).

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
| Region discovery                | [`docs.ts`](../../../src/lib/docs.ts)                                                                                    |
| Agent file mappings             | [`providers.ts`](../../../src/lib/providers.ts)                                                                          |
| Operational-copy universe       | [`agent_surface_contracts.ts`](../../../scripts/agent_surface_contracts.ts)                                              |
| Operational-copy guard          | [`agent_surface_contracts_test.ts`](../../../tests/agent_surface_contracts_test.ts)                                      |
| Maintained ADR index            | [`adr_index.ts`](../../../src/lib/adr_index.ts)                                                                          |
| Refresh behavior                | [`engine_refresh_test.ts`](../../../tests/engine_refresh_test.ts)                                                        |
| Preparation convergence         | [`prepare.ts`](../../../src/engine/gate/prepare.ts)                                                                      |
| ADR index behavior              | [`engine_adr_index_test.ts`](../../../tests/engine_adr_index_test.ts)                                                    |
