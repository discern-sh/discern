# ADR 0331: Common-repository locks precede checkout locks

**Status**: accepted. Applies the operation policy in [ADR 0330](0330-every-command-path-declares-its-operation-effects.md) to the acceptance transaction from [ADR 0194](0194-standing-pre-authorization-is-a-recorded-checked-grant.md) and the linked-worktree model in [ADR 0011](0011-adopt-worktree-workflow.md).

> Amended by [ADR 0394](0394-separate-operation-ownership-from-publication.md): lifecycle ownership and target reservations remain held during execution while common publication is limited to short shared-state transitions.

## Context

Acceptance used a lock stored in one linked worktree's Git administration directory. Separate worktrees therefore held separate locks while they could move the same trunk ref and update the same main checkout. A second acceptance could also inspect the first process's journal during its active transition and mistake in-flight state for interruption evidence.

Checkout-local writers had a related gap. Gate fixers, Proof evidence, tracked refresh, and generated artifacts must describe one coherent checkout state, but a second discern process could enter a conflicting writer in that checkout. Serializing every repository operation would prevent these races while also blocking unrelated worktrees and read-only inspection.

Nested execution adds an order problem. Gate and setup paths can invoke discern children. A child that reacquires a parent lock can deadlock. A checkout-scoped parent that widens to a common-repository lock can invert the acquisition order when another process acquires common first.

## Decision

**discern-owned exclusion uses one operating-system lock capability, and a common-repository lock is always acquired before a checkout lock.**

The common-lock identity derives from the shared Git administration directory, so linked worktrees in one repository contend on the same boundary. The checkout-lock identity derives from that worktree's Git administration directory. Identity-hashed files in a fixed POSIX runtime namespace carry the operating-system locks, avoiding a write to the repository merely to prove later repository-write authority. The namespace is independent of caller-controlled temporary-directory variables, so separate processes cannot resolve different locks for one Git boundary. An operation classified for both acquires common first, then checkout. Acceptance holds that pair before inspecting or recovering an acceptance transaction and through the shared trunk and main-checkout transition.

Lock acquisition is non-blocking. A held boundary produces a routed refusal before the operation body runs. The result names the common-repository or checkout boundary, states that the call made no change, and routes the caller to retry after the active operation finishes. Read-only operations and dry runs acquire no writer lock. Checkout writers in separate linked worktrees remain concurrent.

The open file's operating-system lock is ownership. A standing lock path carries no ownership by itself and is reusable after a process exits. The file contains a random lease token only while a live owner authenticates delegation to a child; release restores the file's prior inert bytes. In-process nesting uses async context. Child processes receive only the leases the parent holds. A nested call may reuse an authenticated lease, but it cannot widen from checkout to common, acquire another checkout, or reverse common-before-checkout order.

When Git administration paths are unavailable for a discovered discern project, the lock capability uses a host-temporary boundary keyed by that project root. A command explicitly classified as a pre-project writer uses the canonical current directory before the root exists. Other commands reach their ordinary not-initialized result without acquiring a writer boundary. Once Git paths resolve, they are authoritative.

## Consequences

- Acceptance transitions from separate worktrees cannot overlap the shared trunk and main-checkout boundary.
- Gate, fixer, refresh, and other checkout writers cannot interleave through separate CLI or Model Context Protocol (MCP) processes in one checkout.
- A process receives a bounded refusal instead of waiting while holding unrelated resources.
- Child discern commands can compose under an outer operation without deadlock, provided the outer policy acquired every needed boundary in order.
- Separate worktrees retain parallelism for checkout-only operations, and observations remain concurrent.
- The protocol depends on advisory file locking provided by the host and on every effectful entry point passing through the shared interceptor.

## Alternatives considered

- **Keep acceptance locking per worktree.** Rejected because those worktrees share the trunk ref and receiving checkout.
- **Use one repository-global lock for every command.** Rejected because it blocks observations and independent checkout writers that share no mutable boundary.
- **Wait for a held lock.** Rejected because a blocked caller would lose the useful no-change result and could hold resources the active operation needs.
- **Treat the lock file as a claim.** Rejected because a process exit can leave the path behind; the operating-system lock has the required lifetime.
