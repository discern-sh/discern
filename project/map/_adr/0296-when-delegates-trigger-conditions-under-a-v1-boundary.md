# ADR 0296: `when` delegates trigger conditions to the project under an explicit v1 execution boundary

**Status**: accepted; the executable escape hatch of [ADR 0293](0293-checkpoint-declarations-interlock-the-gate.md), governed per [ADR 0294](0294-the-merge-base-governs-checkpoint-policy.md)

## Context

The structured trigger menu is closed and deterministic by design: selectors, an inverted conjunction, a size threshold, and two delta-shape predicates. Some real conditions live outside any closed menu ("the generated client drifted from its spec"), and discern already has one idiom for delegating knowledge it cannot have: `[jobs]` and `[standards]` hand a command to the shell and read a protocol from its output. An expression language inside trigger values would grow without bound and still miss cases; a model call is banned from the gate outright.

## Decision

**`when = "<command>"` delegates the firing condition to the project, with a fixed protocol, a short fixed budget, and a fail-open error path.**

- Exit `0` fires the trigger; exit `1` passes; any other exit, a timeout, or a spawn failure FAILS OPEN — no fire — with a plain-language advisory carried on the run. A broken probe can never wedge an effort.
- The command may print `DISCERN_MATCH <path>` lines — the protocol sibling of `DISCERN_METRIC`, same whole-token anywhere-on-a-line convention, rest of the line as the path — to declare the subject paths precisely. Without them the subject falls back to the structural matched set, which reopens more coarsely; declared paths that are empty, absolute, or escape the root are dropped. With selectors present, the selectors pre-scope the diff and provide the default subject; `when` decides the firing.
- Execution funnels through the gate's job runner (capture environment, `discern` self-resolution, process-tree cleanup) under a pinned 10-second budget — a pre-flight condition answers in seconds or it is not a pre-flight condition. There is deliberately no `unless` command key: negation belongs to the structured `unless_changed`, and one executable key keeps the surface auditable.
- **The v1 boundary, stated rather than implied:** the merge-base configuration governs the command TEXT ([ADR 0294](0294-the-merge-base-governs-checkpoint-policy.md)), but the command runs in the candidate worktree, so scripts, dependencies, configuration, and interpreters it references resolve from that worktree. The policy identity proves where the text came from; it does not prove an executable dependency closure. Trusted policy execution is a later cross-cutting concern shared with `[standards]`, scope gates, `[jobs]`, and generated commands — solving it for one key alone would be a false assurance.

## Consequences

- A condition the menu cannot express costs one small script instead of a schema extension, and its failure mode is an advisory, not a blocked effort.
- Firing through `when` is only as deterministic as the project's command; the structured predicates remain the reproducible core, and the fail-open rule bounds the damage of a flaky probe to under-firing, never over-blocking.
- A branch can change what a governed command DOES by editing files it references — visible in the diff, priced into the boundary statement above, and closed only by the future trusted-execution concern.

## Alternatives considered

- **An expression language in trigger values.** Rejected: it grows toward a worse shell while staying weaker than one, and every operator added is surface every project pays for.
- **Fail CLOSED on `when` errors (fire the checkpoint).** Rejected: a broken probe would tax every matching change with a demanded judgment about nothing — the noisy-checkpoint failure mode by construction.
- **Running the command from the merge-base's tree (pristine closure).** Rejected for v1: materializing a historical tree per probe is heavy machinery for a boundary that trusted policy execution must eventually own coherently across every delegated command, not just this one.
