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

The [consumer fixture](../../../tests/fixtures/terminal_application.ts) demonstrates choices, an unavailable entry, a reading block, an asynchronous update, and a harmless child. Its [native process](../../../tests/fixtures/terminal_application_process.ts) exercises the production boundary. The [live desk](../../../src/engine/desk/live.ts) is the production consumer: its subscription observes status while synchronous handlers choose routes. The [view](../../../src/engine/desk/application_view.ts) composes package regions; foreground actions retain the shared lifecycle cores. Choice regions opt into package search with `search: true`, and product help comes from the same key map as shortcut handling.

Single-choice `requestSelection` accepts the package's `InteractionSelectionPresentation`, including `menu` for ordinary and searchable choices. Multi-select continues to use `InteractionChoicePresentation`. Each request keeps its existing default.

## Input ownership

Every I/O wrapper that delegates `read` must retain the same receiver's optional `cancelRead`. Cancellation releases a pending native read while leaving stdin open for foreground children and later requests. Use the ordinary interactive export `observeTerminalIO` for content-free observation, with bounded storage owned by the caller.

The [forwarding guard](../../../tests/terminal_io_forwarding_test.ts) enrolls reconstructed terminal ports across authored code and executable fixtures. The [native application canaries](../../../tests/terminal_application_pty_test.ts) exercise pending-read cancellation through the boundary and tracing observers, child input, application return, and kernel resizing. Deterministic [adapter tests](../../../tests/terminal_application_test.ts) cover policy, immutable updates, unavailable actions, errors, and geometry.

## Testing and migration limits

Import generic transport and complete-frame capture instruments only through `discern-design-system/cli/interactive/testing`. Repository PTY callers use the thin [`pty_process.ts`](../../../tests/fixtures/pty_process.ts) adapter, which retains environment policy, independent readiness and completion allowances, real-PTY admission, and evidence. Product fixtures and compilation remain here. Ordinary runtime graphs must exclude testing helpers, PTY launch modules, and browser frameworks.

Complete-frame capture accepts bounded package paints. Inline consumers retain the existing inline capture path; arbitrary cursor transcripts require their existing specialized fixture. See [terminal output review](reviewing-terminal-output.md) for rendered evidence and the application capture matrix.

General text and mini-chart adapters remain separate work. Adding a consumer event loop, layout language, painter, key decoder, or generic transport would duplicate package responsibilities. A missing generic capability requires a public package API; the package-release procedure below governs adoption ([ADR 0397](../_adr/0397-terminal-applications-and-test-transports-stay-package-owned.md)).

## Package source and releases

Ordinary commands, subprocesses, builds and tests resolve the exact published package selected by `deno.json` and `deno.lock`. They need no sibling checkout. [`design_system_dependency.ts`](../../../tests/design_system_dependency.ts) shares the immutable version and registry origin used by CLI and web conformance. The guards reject committed local overrides, mixed versions, unlocked transitive packages and testing dependencies in ordinary graphs.

Fix generic component gaps in an owner-assigned package effort. Prove and release those changes through that repository's procedure before changing discern's exact pin. Verify the published public exports, run `deno install` to generate the lock, and run `deno task codegen` and `deno task site:build` for notices and site assets. Recheck affected terminal, document-browser and web consumers against that release. Publication and pushes require owner authority.

The [local package preview](../90-site/the-design-system.md#local-package-iteration) supports an explicitly selected source for visual iteration; its temporary configuration never establishes release evidence for ordinary commands or the gate.
