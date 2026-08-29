# ADR 0357: Lock-boundary evidence retires superseded Logbook starts

**Status**: accepted. Amends the unmatched-start liveness rule from [ADR 0210](0210-effectful-verb-starts-are-paired-logbook-events.md) with the operation classification and non-blocking exclusion established by [ADR 0330](0330-every-command-path-declares-its-operation-effects.md) and [ADR 0331](0331-common-repository-locks-precede-checkout-locks.md).

## Context

An interrupted recorder leaves a `begin` without its matching completion. The Logbook retains that line as crash evidence and treats it as a live operation until a duration-based horizon expires. That horizon is useful when no stronger evidence exists, but it can contradict later events: a newer invocation can start, acquire the same non-blocking exclusion boundary, finish, and produce current Proof while the older line still makes the task appear to be running. The Desk then disables actions for an operation that is no longer active.

Time and branch alone cannot repair the claim. An observation can complete beside a writer, checkout-local work can complete in another worktree, and an invocation that started earlier can legitimately finish after a newer start. The operation-effect registry now supplies the missing fact: which common-repository or checkout boundary an invocation must hold while its effect runs.

## Decision

Effectful `begin` and completion events record the invocation's resolved operation-lock boundary. Begin events also retain the dry-run, flag, and operand facts that selected the boundary. These are additive version-1 fields. Historical lines without them fall back to the current operation policy and the invocation facts they carry.

The shared Logbook liveness reader removes an unmatched begin from the live population when all of these facts hold:

- a second invocation has its own paired begin and completion;
- the second begin is later than the unmatched begin;
- the second completion is not a refusal; and
- their resolved lock boundaries overlap: a common boundary with another common boundary, or checkout boundaries on the same recorded branch.

A later operation that satisfies those conditions could not have completed while the older invocation still owned their shared non-blocking boundary. Its completed pair is therefore stronger liveness evidence than the older unmatched start. A matching invocation completion remains the primary way to close a begin. Refusals, observations, another checkout, unpaired completions, and invocations that began first do not supersede it.

Fleet status and Logbook lifecycle safety consume this one liveness population. Supersession changes only the live claim: the unmatched event remains crash evidence and still contributes to branch activity.

## Consequences

- A later successful or failed writer clears an obsolete running state immediately instead of waiting for the freshness horizon.
- A completion cannot clear unrelated concurrent work merely because it happened later.
- Existing Logbooks benefit through policy fallback; newly written events preserve their invocation-time boundary even if the registry changes later.
- Historical mixed or preview invocations can carry fewer classification facts than new events. Their fallback is necessarily less precise, while the freshness horizon remains the final bound.
- No heartbeat, process registry, or mutable liveness file joins the append-only Logbook.

## Alternatives considered

- **Wait only for the duration horizon.** Rejected because it preserves a known-false running state after stronger evidence arrives and can block supervision for hours.
- **Let any later completion retire the begin.** Rejected because observations, other worktrees, and earlier-started operations can complete while the invocation remains live.
- **Probe the operating-system lock from every reader.** Rejected because a point-in-time lock probe does not establish process liveness outside the effect boundary and would add a host-lock dependency to pure Logbook analysis and archived-event tests.
- **Record process ids or heartbeats.** Rejected because process ids are reusable, heartbeats need mutable cleanup and polling, and neither composes with the existing append-only advisory evidence.
