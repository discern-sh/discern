# ADR 0125: An explicit `[guidance] agents = []` means no agents

**Status**: accepted

## Context

`[guidance].agents` names the provider integrations discern compiles guidance and
materializes skills for. When it is not configured, discern emits the default pair
(`claude_code`, `codex`; ADR-era `DEFAULT_AGENTS`). The resolver behind every
call-site — the compiler, the worktree dispatcher, the skills currency check —
is `resolveConfiguredAgents`.

The key carried a schema default of `[]`, and the resolver treated a zero-length
list as "unset": it fell through to the legacy `[project].agents`, then to the
default pair. That made two states indistinguishable. A config with no `agents`
key and a config with `agents = []` parsed to the same value, and both resolved
to the default pair. So an author who wanted discern to emit for **no** agents at
all — a project that keeps its compiled agent files out of the loop, or drives
them by another route — had no way to say so: writing the empty list they would
naturally reach for was silently read as "give me the default two." The generated
config reference compounded it, documenting the default as `[]`, which reads as
"no agents by default" when the true default is the pair.

The empty-collection-conflated-with-absent trap is a recurring defect class; this
is its instance at the config boundary.

## Decision

`[guidance].agents` is **optional** (no schema default), so an absent key and an
explicit empty list are **distinct** and read differently:

- **Omit the key** → the default pair (`DEFAULT_AGENTS`), via the legacy
  `[project].agents` fallback when that is set. Unchanged behaviour.
- **`agents = []`** → emit for **no agents**, honored verbatim. This is the new,
  previously inexpressible reading, and it overrides a legacy `[project].agents`
  (a deliberate "none" wins over the fallback).
- **`agents = [...]`** → that list, in order. Unchanged.

The generated reference documents both readings on the key and no longer
advertises a `[]` default (the default cell is `—`).

## Consequences

- This is a semantic change for one previously-degenerate input: a config that
  literally wrote `[guidance] agents = []` and relied on it resolving to the
  default pair now resolves to no agents. That input was indistinguishable from
  the far more common "unset", produced no agent files anyone depended on
  differently, and had no legitimate use — the change makes the only sensible
  reading of an explicit empty list available. Every other existing config
  (unset, or a non-empty list) resolves exactly as before.
- "What the reference documents is what the resolver does" is restored: the
  omit-vs-empty distinction is stated on the key and covered by a codegen parity
  guard, and the resolver's two readings are pinned by a unit guard driven off
  `DEFAULT_AGENTS`.
- `resolveConfiguredAgents` stays the single reader; direct readers of the field
  already coalesce `undefined`, so the optional type required no call-site change.
