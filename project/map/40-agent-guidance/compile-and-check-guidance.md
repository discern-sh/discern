---
title: Compile and check guidance
description: Run refresh, inspect the agent files, and keep every configured agent on the current sources.
order: 20
aliases:
  - refresh guidance
  - agent files
  - generated guidance
---

# Compile and check agent guidance

_After a Guidance edit, run `discern refresh`, review the generated files, and commit the tracked outputs with their sources._

## Refresh the agent files

From the project root, run:

```sh
discern refresh
discern status
```

`refresh` combines discern's built-in Guidance with `[guidance].sources`. It also reconciles Skills, agent integration artifacts, and the maintained architecture decision record (ADR) index. That index is the record list between markers in the Map's ADR README, regenerated from the record files on disk. `status` reports any generated Guidance, materialized Skills, or ADR index that still differs from the current sources.

The ADR index is opt-in by construction: a README that carries the `BEGIN GENERATED` markers is maintained, one without them is never touched. Fresh installs receive the markers from the setup skeleton; an existing project adopts the index by adding them.

The built-in Map section also derives a compact region list from the configured Map ([ADR 0174](../_adr/0174-agent-document-discovery-funnel.md)). Each non-internal top-level directory contributes its region target and front-door title. Adding or renaming a region, or changing its front-door title, changes the agent files. Other changes within an existing region leave that list unchanged. Run `discern refresh` after either kind of source change; the currency check reports whether the tracked outputs changed.

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

Do not edit a compiled file to fix its prose. The next refresh replaces that edit, and the Gate's currency check reports the drift. Edit the configured source, then refresh again.

`discern done` runs the same currency check before the slower Gate stages. A mismatch stops the Gate early and names the generated files that need refreshing ([ADR 0034](../_adr/0034-agents-md-untracked-currency-check.md)).

## Check each agent-copy source at its authority

The repository checks operational agent copy in two ways. Core rules shared by bundled Guidance and Model Context Protocol instructions derive from the operating-policy registry and its parity guard. Task procedures derive from the effective Skill resolver and setup-template directory. Each derived surface joins a repository-only classification registry whose structural fields point to exact excerpts in the authored prose.

The contract registry never renders into a Skill or setup brief. A separate guard checks the authored corpus and a temporary bundled-Skill materialization for escaped internal metadata. The derived corpus also passes through the generated `DiscernAgent` Vale style. Prefix selection enrolls later rules without copied patterns or identifiers. Structural checks retain stop, recovery, authority, and relay guarantees that phrase matching cannot determine ([ADR 0267](../_adr/0267-operational-contracts-stay-outside-agent-copy.md)).

## Current state & gotchas

- An explicit empty `[project].agents` list emits no instruction files.
- discern generates a provider-specific pointer only when its canonical target exists. Otherwise that provider receives the full compiled body.
- Git ignores materialized Skills and tracks agent files unless your own `.gitignore` rules say otherwise.
- A successful `discern update` or `discern accept` refreshes its resulting checkout. An ordinary source edit still needs `discern refresh` before the Gate passes.

## Where it lives in code

| Concern                         | Source                                                                              |
| ------------------------------- | ----------------------------------------------------------------------------------- |
| Compilation and file writes     | [`guidelines.ts`](../../../src/engine/guidelines.ts)                                |
| Canonical and pointer rendering | [`guidance_render.ts`](../../../src/engine/guidance_render.ts)                      |
| Region discovery                | [`docs.ts`](../../../src/lib/docs.ts)                                               |
| Agent file mappings             | [`providers.ts`](../../../src/lib/providers.ts)                                     |
| Operational-copy universe       | [`agent_surface_contracts.ts`](../../../scripts/agent_surface_contracts.ts)         |
| Operational-copy guard          | [`agent_surface_contracts_test.ts`](../../../tests/agent_surface_contracts_test.ts) |
| Maintained ADR index            | [`adr_index.ts`](../../../src/lib/adr_index.ts)                                     |
| Refresh behavior                | [`engine_refresh_test.ts`](../../../tests/engine_refresh_test.ts)                   |
| ADR index behavior              | [`engine_adr_index_test.ts`](../../../tests/engine_adr_index_test.ts)               |
