# ADR 0252: The fleet test-run cap is enforced at the test command boundary

**Status**: accepted. Extends [ADR 0212](0212-fleet-test-run-cap-os-lock-slots.md), [ADR 0159](0159-inherited-terminal-children-have-one-owned-lifecycle.md), and [ADR 0180](0180-every-spawn-surface-declares-its-interrupt-contract.md). Creates a reviewed exec-surface exception to [ADR 0027](0027-plan-apply-engine-execution.md) and [ADR 0028](0028-result-envelope-and-diagnostics.md). Supersedes ADR 0212's clause **“The begin event precedes the wait, and the recorded duration includes it”** with the split wait-accounting contract below; the begin order and end-to-end meaning remain, while queue time stops contaminating execution-time priors.

## Context

ADR 0212 caps test-stage groups that enter through discern's gate verbs. The slot files are the authority, but admission still happens at a polite entrance: an agent running the project's test command directly never reaches the gate executor and therefore never takes a slot. That is the habitual inner-loop path, especially for a targeted test that `discern test` cannot express. Several sibling worktrees can consequently oversubscribe the machine while each agent follows the project's own testing guidance.

The cap needs a resource boundary that direct and gate-driven test commands share. It must preserve an arbitrary command's arguments and terminal behavior, stay invisible when a project has no active cap, and fail open when the advisory lock surface is unavailable. It must also compose: the gate often invokes the same project test task that a developer runs directly, so a wrapper beneath an already-admitted gate must not acquire again and deadlock at a cap of one.

This is cooperative back-pressure, not a security boundary. The project controls its task definitions and environment, and an advisory marker can be forged. Preventing deliberate bypass would require a process sandbox or test-runner integration, neither of which belongs in discern's stack-neutral gate.

## Decision

**A project with a concurrent test-run cap wraps its canonical test task as `discern queue -- <command> [args…]`.** The wrapper acquires one of ADR 0212's existing slot files, runs the raw command while holding it, and releases it when the wrapper process exits. The gate and wrapper share one acquisition core for probing, backoff, jitter, wait decoration, and fail-open policy; each surface owns its presentation. The gate retains its existing result hints and narration. The wrapper writes the same queued or unavailable hint text to stderr only.

The wrapper is deliberately transparent outside an active limiter:

- a positive cap acquires before spawning and holds for the child's lifetime;
- a zero or absent cap runs immediately and creates no slot directory;
- no `discern.toml` runs immediately and silently, so an exported task file remains usable;
- an unavailable git common directory or slot file warns once, then runs the command uncapped.

**`queue` is an exec-style CLI boundary.** `src/main.ts` intercepts it before Cliffy and consumes only the required `--`; every later token belongs to the child. The owned-child surface provides inherited stdio, parent-environment preservation, interrupt forwarding and tree cleanup. A normal exit is mirrored, signal death is mirrored with the conventional signal status, and a command that cannot be spawned returns 127. A malformed invocation returns a usage error that teaches `discern queue -- <command> [args…]` through the shared semantic-groups renderer.

The child's streams and process status are the protocol, so `queue` has no plan/apply projection, `DiscernResult`, `--json`, or logbook event. This is the same reviewed class as Project Scripts: an explicit exception to ADR 0027 and ADR 0028 rather than a partial result surface. It is CLI-only. Model Context Protocol callers already have `discern_test`, while an arbitrary child's raw arguments, inherited streams, and exit status have no faithful tool-result representation. The MCP parity registry records that deliberate absence.

**`DISCERN_TEST_SLOT=1` means “the cap is accounted above you.”** Any non-empty value reads as set. The gate writes the marker into every job in a capped test-stage group both after a held acquisition and after fail-open. `queue` under the marker does not inspect config or slot files, and every `queue` invocation writes the canonical value `1` to its child. The meaning is intentionally broader than “a lock is held”: once an ancestor has made the fail-open decision, a descendant must not independently probe the broken surface or queue behind a limiter the ancestor said would not block it.

**Wait accounting separates experience from execution without changing either fact.** A completion event keeps `duration_ms` as the end-to-end time from invocation through waiting and execution. It may add `waited_ms`; execution time is `duration_ms - (waited_ms ?? 0)`. Duration priors use that execution time, while displays and pattern detection can treat waiting as its own number. Gate begin events continue to precede admission waits so fleet views can show the invocation as active. This supersedes ADR 0212's combined clause because its conclusion—that wait should fold into future duration estimates—no longer holds. The exec wrapper itself writes no logbook events; telemetry remains attached to discern's gate invocations.

The current operating guidance is [The fleet test-run cap](../20-quality-gate/concurrent-test-runs.md). CI installation requirements live in [Run the gate in CI](../20-quality-gate/ci.md).

## Consequences

- Wrapping the project's default test task makes full and targeted direct invocations contend with gate runs through the same OS lock files. The habitual command is capped by construction rather than by agent memory.
- A gate can invoke that wrapped task at a cap of one without waiting on itself. Nested wrappers also consume one slot total, and a gate that failed open does not trigger a second warning or probe below it.
- The wrapper preserves the crash-safety of ADR 0212: the process that owns the file descriptor owns the child lifecycle, and the kernel releases the lock if that process dies.
- The marker and advisory locks deter accidental oversubscription, not intentional bypass. A command can omit the wrapper or forge the marker.
- A wrapped task requires the discern binary on `PATH`. The canonical CI workflow already installs it; other automation and cloud-agent environments that invoke the task must do the same. A separately named raw task may serve environments that cannot install discern, but it is not the default.
- Queue telemetry can evolve without changing admission or the wrapper's exec contract. Historical completion events without `waited_ms` continue to read as all execution time, while new events can report both end-to-end and wait-specific views.

## Alternatives considered

- **Keep admission only in gate verbs.** Rejected: direct targeted runs are the common inner loop and remain the largest source of unbounded fleet concurrency.
- **Name the verb `slot`, `cap`, `admit`, or `turn`.** Rejected: `queue` names the user's intent, matches the existing “Tests queued” surface, and reads as an imperative beside the other verbs. `slot` and `cap` expose mechanism; `admit` and `turn` obscure what the command does while waiting.
- **Set the marker only while a slot is held.** Rejected: after gate fail-open, an inner wrapper would probe again and could wait or warn independently, contradicting the ancestor's decision to proceed without enforcement.
- **Expose an MCP tool.** Rejected: MCP callers can run the typed gate verb, and the wrapper's defining contract—raw arguments, inherited streams, and child exit status—does not map to a structured tool result without ceasing to be transparent.
