# ADR 0397: Terminal applications and test transports stay package-owned

**Status**: accepted on 2026-09-14. Extends [ADR 0279](0279-external-terminal-rendering-crosses-one-process-boundary.md) and preserves the admission contract of [ADR 0355](0355-real-pty-tests-declare-os-boundary-contracts.md).

## Context

Persistent terminal applications combine layout, native input, immutable updates, and foreground children. Rebuilding those mechanics in each consumer creates competing readers and painters. Generic PTY machinery also needs platform-specific readiness and descendant cleanup, while discern's test policy must still account for every real-terminal process.

The design system provides an application runtime, pure composition functions, and a separate testing export. Its complete-frame capture protocol deliberately requires a bounded repaint. Existing inline journeys and specialized cursor-based harnesses need different capture treatment during adoption.

## Decision

Expose the package application runtime through discern's established terminal interaction boundary. The wrapper owns product admission, theme and appearance, cancellation translation, and error handling. The package owns layout, input, painting, resizing, foreground release, and restoration. Every forwarding I/O port retains optional native read cancellation without closing stdin; generic observation comes from the ordinary package graph.

Use the package testing export for generic PTY transport and bounded complete-frame capture. Keep a thin discern adapter for environment policy, independent infrastructure allowances, real-PTY declarations, and evidence. Keep product fixture construction and binary compilation in discern. Preserve the inline capture path and specialized harnesses until their callers can use an equivalent public package contract.

Ordinary executable graphs exclude testing helpers, browser frameworks, and PTY launch dependencies. Public-import graph checks enforce this separation. A missing generic capability is addressed upstream. The serial Desk programme temporarily selects its retained source worktree in committed Deno configuration, with an exact source revision receipt, a clean-tree check, locked transitive packages and source-derived license credits. This explicit owner-directed development mode keeps package iteration available across independently landed consumer stages. Final stage 4A integrates and proves the upstream work, coordinates authorized landing and immutable publication, then removes the link and restores registry-origin consumer checks.

## Consequences

Source commands temporarily require the retained package directory, and an upstream edit needs a committed revision and renewed consumer evidence. The interim gate establishes local integration, not portable release consumption. The ordinary immutable package boundary resumes at 4A.

Application consumers can update a view and return from a foreground child without owning terminal mechanics. Pending native reads are tested through the actual forwarding and tracing layers, since synchronous fake reads cannot establish input ownership.

Transport changes inherit package behavior and require consumer regressions for environment policy, readiness, compilation, cleanup, and test accounting. The complete-frame protocol refuses partial or oversized frames; it cannot replace an arbitrary cursor transcript interpreter. Consumer adoption therefore proceeds without changing desk composition, lifecycle semantics, or deferred text and chart adapters.

## Alternatives considered

A consumer event loop or copied PTY implementation permits faster local changes but creates a second authority for terminal mechanics. Importing observation from the testing export puts launch machinery in ordinary runtime graphs. Both alternatives make future application consumers pay for boundaries the package already owns.
