# ADR 0125: An explicit `[project] agents = []` means no providers

> **Glossary vocabulary amendment ([ADR 0169](0169-the-launch-glossary-canon.md)):** Current pointers use `Compiled agent file` → `Agent file`; the decision and reasoning are unchanged.

**Status**: accepted

## Context

`[project].agents` names the provider integrations discern compiles agent files and materializes Skills for. When it is not configured, ordinary resolution uses the default pair (`claude_code`, `codex`); fresh setup may propose registry-derived installed-on-this-machine evidence before consent. The resolver behind every runtime call site is `resolveConfiguredAgents`.

The key once carried a schema default of `[]`, and the resolver treated a zero-length list as "unset." That made two states indistinguishable: omitting `agents` and writing `agents = []` both resolved to the default pair. An author who wanted no provider integrations had no way to say so.

The empty-collection-conflated-with-absent trap is a recurring defect class; this is its instance at the config boundary.

## Decision

`[project].agents` is **optional** (no schema default), so an absent key and an explicit empty list are **distinct** and read differently:

- **Omit the key** → ordinary runtime resolution uses `DEFAULT_AGENTS`; fresh setup may propose installed providers before confirmation.
- **`agents = []`** → emit for **no providers**, honored verbatim. Ambient installation evidence never overrides it.
- **`agents = [...]`** → that list, in order. Unchanged.

The generated reference documents both readings on the key and no longer advertises a `[]` default (the default cell is `—`).

## Consequences

- The explicit empty list is a durable repository choice. Detection, refresh, resumption, and runtime compilation preserve it.
- "What the reference documents is what the resolver does" is restored: the omit-vs-empty distinction is stated on the key and covered by a codegen parity guard, and the two readings the resolver implements are pinned by a unit guard driven off `DEFAULT_AGENTS`.
- `resolveConfiguredAgents` stays the single reader; direct readers of the field already coalesce `undefined`, so the optional type required no call-site change.
