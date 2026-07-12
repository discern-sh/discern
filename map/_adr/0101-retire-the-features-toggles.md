# ADR 0101: Retire the `[features]` toggles

> **Vocabulary amendment ([ADR 0120](0120-launch-verb-canon.md)):** Current
> pointers use `ratchets` → `standards`; the decision and reasoning are
> unchanged.

**Status**: accepted; amends [ADR 0020](0020-dissolve-discern-dir.md) (which
introduced the `[features]` set) and completes the trajectory of
[ADR 0045](0045-mcp-is-core-infrastructure.md) (which removed `mcp` from it)

## Context

[ADR 0020](0020-dissolve-discern-dir.md) introduced `[features]` so a disabled
subsystem could vanish coherently: verbs hidden, hooks unwritten, guidance
sections dropped, doctor checks skipped. The set has only ever shrunk in spirit
— [ADR 0045](0045-mcp-is-core-infrastructure.md) promoted `mcp` to core — while
growing in members (`coupling` joined later). Today six toggles gate five
subsystems across the dispatcher, the hook writers, the guidance compiler,
doctor, the MCP server, and the gate planner.

Three observations, made while every toggle still has zero external users:

1. **The toggle test.** A subsystem that costs nothing when unused needs no
   switch. Worktrees you never start, standards you never define, an advisory
   verb you never invoke — the escape is behavioral. A toggle earns its keep
   only when an _unused_ feature still imposes a real cost.
2. **Each toggle is a combinatorial promise.** Both states of every toggle must
   keep working forever, multiplied together — yet the off-states are never
   self-hosted (this repo runs everything on), which makes them the permanently
   untested half of the matrix.
3. **The pre-release asymmetry.** Adding a toggle later is backwards-compatible;
   removing one later is a breaking change. Keeping an unproven toggle now is
   the only irreversible choice on the table.

There is also a live single-source-of-truth violation: `[worktree].enabled`
duplicates `[features].worktrees` in the shipped template — two keys claiming
the same fact.

## Decision

- **The `[features]` section is removed entirely; every subsystem is core.** The
  feature/capability terminology split dissolves with it — `[capabilities]`
  remains what it always was, the gate's command table.
- **Worktrees are discern's spine, not an option.** The isolated-worktree
  workflow is core to how discern works; "discern uses worktrees" is a product
  sentence with no configuration attached. Verbs, hooks, guidance, and doctor
  checks are always wired. Nothing forces a session to call `start` — not using
  the workflow remains the escape, configuring it away does not. The duplicate
  `[worktree].enabled` key retires at the same time.
- **Standards activate by presence, not by toggle.** With no `[standards]`
  tables defined the subsystem is naturally inert; defining one is the act that
  turns it on. The standards guidance section compiles in only when at least one
  standard is configured — gating on configuration, not on a switch.
- **Guidance, docs, and the coupling advisory are core.** Guidance is discern's
  only channel to agents — disabling it severed the nervous system. The map is
  the product ([ADR 0100](0100-project-map-is-the-agents-map.md)). Coupling is
  read-only, self-calibrating, and invoked on demand; its one real cost decision
  (`[coupling].in_gate`) is behavior configuration and stays.
- **Skills keep one knob, in reduced form: `[skills].exclude`.** Materialized
  skills are the single subsystem that imposes a cost while unused — every skill
  occupies context in every agent session. A per-skill exclusion list (additive,
  by name) meets that honestly; a whole-subsystem kill-switch was the blunt
  version of it.
- **A schema migration drops `[features]` and `[worktree].enabled`** from
  existing configs, noting any non-default value it discards.

## Consequences

- The dispatcher, hook writers, guidance compiler, doctor, MCP server, and gate
  planner lose their feature-gating branches; the `VERB_FEATURE` map and its
  parity-test leg go with them. The test matrix roughly halves several times
  over.
- `discern.toml` loses its most confusing section (the feature-vs-capability
  distinction has needed a warning comment since it existed) and the docs lose
  the concept.
- A future subsystem that genuinely passes the toggle test can get a toggle back
  compatibly; nothing re-opens by default.
- Users who want less discern do it behaviorally (don't start worktrees, define
  no standards, exclude skills by name) — every escape remains, none of them
  configurational existence-switches.

## Alternatives considered

- **Keep the full set.** Rejected: five subsystems × two states of untested
  surface, held open forever, for preferences no user has expressed.
- **Keep only `[features].worktrees`.** Rejected: worktrees are the subsystem
  _least_ eligible — the whole workflow model assumes isolation, and an install
  with worktrees off is a discern nobody dogfoods or documents.
- **Replace toggles with setup-time profiles/presets.** Rejected as redundant:
  presets already shape what setup writes; a runtime existence-toggle is a
  different and heavier promise.
