---
title: Compose terminal applications
description: Run a package-owned application through discern's process and interaction boundaries, and choose the appropriate testing seam.
aliases:
  - terminal application
  - application viewport
  - foreground handoff
---

# Compose terminal applications

Use `runTerminalApplication` from [`terminal_interaction.ts`](../../../src/lib/terminal_interaction.ts) for a persistent application viewport. The wrapper applies discern's interaction admission, process theme, appearance, motif, cancellation translation, and error handling. It uses the same process I/O as `requestMarkdownBrowser` and the existing requests.

## Composition and effects

Import composition types and pure application functions from `discern-design-system/cli/interactive`. Import `createCliBlock` and renderers from `discern-design-system/cli`. The package owns region fitting, focus, key decoding, painting, resizing, and restoration. Its `TERMINAL_APPLICATION_MINIMUM` defines the minimum geometry; smaller terminals receive its resize prompt.

The wrapper's `TerminalApplicationOptions<Action>` preserves the package options. Supply a view with stable region and entry identities. The `start` callback receives a context whose `update` method publishes a replacement immutable view; return cleanup for any provider subscription. An action can return a foreground command through `{ kind: "foreground", run }`. The package releases its input and terminal modes, awaits that command, and resumes the application. Keep product discovery and lifecycle execution in those provider and action boundaries.

The [consumer fixture](../../../tests/fixtures/terminal_application.ts) demonstrates choices, an unavailable entry, a reading block, an asynchronous update, and a harmless child. Its [native process](../../../tests/fixtures/terminal_application_process.ts) exercises the production boundary. This fixture is an adoption example; desk composition and lifecycle behavior remain in their existing modules.

Single-choice `requestSelection` accepts the package's `InteractionSelectionPresentation`, including `menu` for ordinary and searchable choices. Multi-select continues to use `InteractionChoicePresentation`. Each request keeps its existing default.

## Input ownership

Every I/O wrapper that delegates `read` must retain the same receiver's optional `cancelRead`. Cancellation releases a pending native read while leaving stdin open for foreground children and later requests. Use the ordinary interactive export `observeTerminalIO` for content-free observation, with bounded storage owned by the caller.

The [forwarding guard](../../../tests/terminal_io_forwarding_test.ts) enrolls reconstructed terminal ports across authored code and executable fixtures. The [native application canaries](../../../tests/terminal_application_pty_test.ts) exercise pending-read cancellation through the boundary and tracing observers, child input, application return, and kernel resizing. Deterministic [adapter tests](../../../tests/terminal_application_test.ts) cover policy, immutable updates, unavailable actions, errors, and geometry.

## Testing and migration limits

Import generic transport and complete-frame capture instruments only through `discern-design-system/cli/interactive/testing`. Repository PTY callers use the thin [`pty_process.ts`](../../../tests/fixtures/pty_process.ts) adapter, which retains environment policy, independent readiness and completion allowances, real-PTY admission, and evidence. Product fixtures and compilation remain here. Ordinary runtime graphs must exclude testing helpers, PTY launch modules, and browser frameworks.

Complete-frame capture accepts bounded package paints. Inline consumers retain the existing inline capture path; arbitrary cursor transcripts require their existing specialized fixture. See [terminal output review](reviewing-terminal-output.md) for rendered evidence and the application capture matrix.

General text and mini-chart adapters remain separate work. Adding a consumer event loop, layout language, painter, key decoder, or generic transport would duplicate package responsibilities. A missing generic capability requires a public package API; the development-source procedure below governs iteration before formal release ([ADR 0397](../_adr/0397-terminal-applications-and-test-transports-stay-package-owned.md)).

## Development source during adoption

During the serial desk rebuild, the owner retains one design-system worktree for package changes. The committed `deno.json` link makes ordinary commands, subprocesses, builds and tests use that source through public exports. Source checkouts require that local directory; this mode does not establish a portable registry dependency. The exact assignment and final cutover belong to the programme briefs.

[`design_system_dependency.ts`](../../../tests/design_system_dependency.ts) identifies the assigned source root and branch. Consumer checks validate the current files there, allowing upstream agents to edit and commit independently. Source cleanliness, commit identity and ancestry are outside this binding: the gate must accept both committed changes and work in progress. It still checks public imports, runtime graphs and license credits, and rejects other package overrides. Use `deno install` to update the lock and `deno task codegen` for generated outputs. Gate results describe the code exercised during that run; they cannot guarantee later upstream edits.

2A and 3A retain the package worktree after their consumer landing. 4A performs the final upstream integration and full gate, coordinates authorized landing and publication, verifies the immutable release, removes the committed link and temporary worktree binding, and restores registry-origin checks. Its final consumer gate and visual review use the published package. The temporary source dependency is not permission to publish discern or the package, and unrelated web work remains outside this programme's source ownership.
