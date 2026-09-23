# ADR 0368: Local durable formats declare forward skew

> **Amendments.**
>
> - **[ADR 0390](0390-public-contracts-preserve-behavior-and-independent-format-versions.md):** Private current format versions stay in the registry and are omitted from the public conventions manifest. Format ownership, compatibility review, and forward-skew behavior remain required.
> - **Workspace contract ([ADR 0389](0389-the-workspace-contract.md)):** acceptance lands only a submitted commit with honored Proof and no longer runs the Gate itself, so after a pin the caller runs `done` before `accept`.

**Status**: accepted. Extends the Git-admin placement registry in [ADR 0165](0165-git-admin-state-namespaced-by-lifetime.md), the exact Gate evidence model in [ADR 0319](0319-current-green-proof-composes-and-red-reruns-stay-explicit.md), and replay-safe worktree effects in [ADR 0367](0367-worktree-local-state-records-intent-before-effects.md). Amends the Standards pin optimization in [ADR 0106](0106-standards-pin-carries-the-gate-receipt.md).

## Context

discern persists authority, recovery journals, evidence caches, histories, and convenience state below Git administration. Their paths were registered, but their document contracts were not. Versions lived beside individual parsers, some writers repeated numeric literals, and several readers collapsed a newer record into missing or malformed state. A later write could then replace bytes owned by a newer discern. The local Gate Proof used a line protocol without a version whose optional prefixes could not distinguish a compatible extension from Markdown content.

The resource ledger exposed the effectful form of the same problem. One record represented both an intention to create and completed creation, so interruption could turn an uncertain external effect into false readiness.

## Decision

`ON_DISK_FORMATS` is the sole authority for every versioned document discern writes in Git-admin state or under the Proof-notes ref. Each member declares a stable id, registered storage coordinate, current positive version, in-band version field, reader, writer set, and one forward-version policy. Writers import the version from the registry. A structural guard joins the registry to every Git-admin coordinate and requires an explicit reason for non-document state such as locks, capability keys, leases, generated executables, and presence-only sentinels.

Authority and effect-replay formats use `refuse`: a newer version blocks the consuming or replacing operation and names the update recovery. Advisory caches and histories use `observe`: an older reader may proceed without their contents, but inspection exposes the skew and every writer, expiry pass, and cleanup preserves the newer bytes. Missing versions never imply version 1. Older or malformed records remain unusable unless a format declares a specific migration elsewhere.

The worktree Gate Proof is registered JSON with `version`, full `head`, `mode`, optional structured `proof`, and optional declaration `evidence`. The structured Proof carries any live Standard-proposal set. Text without a version is a cache miss and requires a fresh `discern done`; it has no compatibility reader. An incomplete current marker remains observable but cannot narrow Standard measurement, satisfy reusable Gate Proof, or skip acceptance validation. `done --ci` retains a complete same-HEAD strict record rather than replacing it with report evidence.

A Proof cannot move to a new commit without the complete Gate result for that commit. `standards --pin` therefore leaves the parent Proof stale and directs the caller to run `discern done`; acceptance runs that Gate when the caller does not. This replaces the earlier tree-only carry optimization.

The resource-ledger format includes its `intent` and `ready` phases. Intent persists complete ownership and frozen cleanup before create; ready is written only after create succeeds. Its transition and forward-version behavior use the same registered contract.

Completion schema exports can carry a reviewed digest in the format registry. The completion family union enrolls optional fields and new families in that guard. A strict-reader extension requires a version and compatibility decision even when a new field is optional. The explicit version-2 completion reader changes only the envelope in memory, retains byte identity, and archives the original on a later mutable transition. It never infers authority.

## Consequences

- A mixed-version fleet cannot silently downgrade local evidence or replay effects under a schema it does not understand.
- Every new Git-admin document must enroll in both placement and format authorities before the gate passes.
- A cache may lose optimization under forward skew, but never the newer bytes. An authority-bearing record refuses instead of guessing.
- Gate Proof now has one parse boundary, and old private text cannot acquire public compatibility obligations.
- Pinning a Standard may add one Gate run. Exact evidence takes precedence over preserving an optimization that cannot reproduce the new Proof.

## Alternatives considered

- **Treat absent versions as version 1.** Rejected because it makes an accidental private shape a permanent public compatibility branch.
- **Use one policy for every format.** Rejected because an advisory tip cache may be ignored safely while an acceptance journal or effort grant may not.
- **Reset newer convenience state.** Rejected because mixed binaries are normal across linked worktrees and an older writer does not own newer bytes.
- **Carry a tree-only Gate marker across pinning.** Rejected because the new commit has a different subject and diff, while the pin command does not retain the complete Gate steps needed to derive truthful presentation.
