---
title: Compile and check guidance
description: Run refresh, inspect the compiled agent files, and keep every configured agent on the current sources.
order: 20
aliases:
  - refresh guidance
  - compiled agent files
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

`refresh` combines discern's built-in guidance with `[guidance].sources`. It also reconciles Skills and agent integration artifacts, so the generated surfaces agree after one command. `status` reports any generated guidance or materialized Skills that still differ from the current sources.

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

discern generates compiled agent files, and git tracks them by default. A bare clone then carries the current instructions before it can run `discern refresh` ([ADR 0128](../_adr/0128-enumerated-ownership-tracked-guidance.md)). Review and commit the source edit and generated files in the same change.

Do not edit a compiled file to fix its prose. The next refresh replaces it, and the gate's currency check reports the drift. Return to the configured source, edit there, and refresh again.

`discern done` runs the same currency check before the slower gate stages. A mismatch stops the gate early and names the generated files that need refreshing ([ADR 0034](../_adr/0034-agents-md-untracked-currency-check.md)).

## Current state & gotchas

- An explicit empty `[guidance].agents` list emits no instruction files.
- discern generates a provider-specific pointer only when its canonical target exists. Otherwise that provider receives the full compiled body.
- Git ignores materialized Skills and tracks compiled agent files unless your own `.gitignore` rules say otherwise.
- `discern update` and `discern accept` refresh the checkout they leave ready for work, but an ordinary source edit still needs `discern refresh` before the gate passes.

## Where it lives in code

| Concern                         | Source                                                            |
| ------------------------------- | ----------------------------------------------------------------- |
| Compilation and file writes     | [`guidelines.ts`](../../../src/engine/guidelines.ts)              |
| Canonical and pointer rendering | [`guidance_render.ts`](../../../src/engine/guidance_render.ts)    |
| Agent file mappings             | [`providers.ts`](../../../src/lib/providers.ts)                   |
| Refresh behavior                | [`engine_refresh_test.ts`](../../../tests/engine_refresh_test.ts) |
