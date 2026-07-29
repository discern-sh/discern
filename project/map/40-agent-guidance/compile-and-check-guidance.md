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

_Run `discern refresh` after a guidance edit, review the generated files, and commit the tracked outputs with their sources._

## Refresh the agent files

From the project root, run:

```sh
discern refresh
discern status
```

`refresh` combines discern's built-in guidance with `[guidance].sources`. It also reconciles Skills, agent integration artifacts, and the maintained ADR index — the record lists kept between markers in the map's ADR README, regenerated from the record files on disk — so the generated copies agree after one command. `status` reports any generated guidance, materialized Skills, or ADR index that still differs from the current sources.

The ADR index is opt-in by construction: a README that carries the `BEGIN GENERATED` markers is maintained, one without them is never touched. Fresh installs receive the markers from the setup skeleton; an existing project adopts the index by adding them.

The built-in map section also derives a compact region list from the configured map ([ADR 0174](../_adr/0174-agent-document-discovery-funnel.md)). Each non-internal top-level directory contributes its exact region target and front-door title. Adding or renaming a region, or changing its front-door title, changes the agent files; adding, moving, or editing other leaves inside an existing region does not change that list. Run `discern refresh` after either kind of source change: the currency check decides whether the tracked outputs moved.

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

discern generates agent files, and git tracks them by default. A bare clone then carries the current instructions before it can run `discern refresh` ([ADR 0128](../_adr/0128-enumerated-ownership-tracked-guidance.md)). Review and commit the source edit and generated files in the same change.

Do not edit a compiled file to fix its prose. The next refresh replaces it, and the gate's currency check reports the drift. Return to the configured source, edit there, and refresh again.

`discern done` runs the same currency check before the slower gate stages. A mismatch stops the gate early and names the generated files that need refreshing ([ADR 0034](../_adr/0034-agents-md-untracked-currency-check.md)).

## Current state & gotchas

- An explicit empty `[project].agents` list emits no instruction files.
- discern generates a provider-specific pointer only when its canonical target exists. Otherwise that provider receives the full compiled body.
- Git ignores materialized Skills and tracks agent files unless your own `.gitignore` rules say otherwise.
- `discern update` and `discern accept` refresh the checkout they leave ready for work, but an ordinary source edit still needs `discern refresh` before the gate passes.

## Where it lives in code

| Concern                         | Source                                                                |
| ------------------------------- | --------------------------------------------------------------------- |
| Compilation and file writes     | [`guidelines.ts`](../../../src/engine/guidelines.ts)                  |
| Canonical and pointer rendering | [`guidance_render.ts`](../../../src/engine/guidance_render.ts)        |
| Region discovery                | [`docs.ts`](../../../src/lib/docs.ts)                                 |
| Agent file mappings             | [`providers.ts`](../../../src/lib/providers.ts)                       |
| Maintained ADR index            | [`adr_index.ts`](../../../src/lib/adr_index.ts)                       |
| Refresh behavior                | [`engine_refresh_test.ts`](../../../tests/engine_refresh_test.ts)     |
| ADR index behavior              | [`engine_adr_index_test.ts`](../../../tests/engine_adr_index_test.ts) |
