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

The wrapper's `TerminalApplicationOptions<Action>` preserves the package options: a view (header, body, message, footer hints, layers, window title), a static key map, and callbacks. Supply stable list, item and layer identities. The `start` callback receives a context whose `update` method publishes a replacement immutable view; return cleanup for any provider subscription. A view returned from a callback applies before the next key is decoded, and a layer disappears only when the view stops declaring it. An action can return a foreground command through `{ kind: "foreground", handoff, run }`: the package paints the handoff line, releases its input and terminal modes, awaits the command, and resumes the application. An action can instead return `{ kind: "background", id, run(report, signal) }`: the work runs while the screen stays live, its reports reach `onReport` between inputs, `onCommandSettled` says how it ended, and its signal aborts only through `context.abort(id)`, an exit, or the session ending. The package isolates no processes, so background work that spawns children must run under the `operation` interrupt source ([subprocess boundaries](../50-engine-internals/subprocess-boundaries.md)) and inside an output capture, as the desk's operations do. Keep product discovery and lifecycle execution in those provider and action boundaries. The wrapper passes the runtime's `observe`, `clock` and `onInterrupt` through, so tests can run the application on a manual clock and a host can take SIGINT on its owned screen.

The [consumer fixture](../../../tests/fixtures/terminal_application.ts) demonstrates a master-detail list, an item without a primary action, an asynchronous update, a key map, and a harmless child. Its [native process](../../../tests/fixtures/terminal_application_process.ts) exercises the production boundary. The [desk](../30-worktrees/the-desk.md) is the production consumer: its [live controller](../../../src/engine/desk/live.ts) maps every callback onto one event of a pure product state machine and returns the next view synchronously; its changes run as background commands and its launches as foreground commands, both through the shared lifecycle cores. Product help reads the same key map the package binds.

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

## Develop against a local package

Run discern's CLI surfaces against an unreleased package checkout with the `cli:design-system` task. It defaults to the design system's repository checked out beside discern's Git main checkout; `--checkout` selects another, such as a package worktree:

```sh
deno task cli:design-system check
deno task cli:design-system --checkout /path/to/design-system-worktree test tests/engine_desk_state_test.ts
deno task cli:design-system capture .scratch/desk-local
deno task cli:design-system desk --project .scratch/desk-sandbox/project
```

`check` type-checks the CLI entry, every desk module, and the desk's test fixtures and scripts, or the modules you name. `test` runs the named files through the suite runner, and `capture` runs the desk gallery; each holds a test-queue slot. `desk` opens the desk from this checkout's source in `--project`, a path relative to this checkout.

The task shares the site preview's link lifecycle in [`local_design_system.ts`](../../../scripts/local_design_system.ts), with the CLI export set: the package root, `./cli`, `./cli/interactive`, `./cli/interactive/testing`, and `./cli/projection`. It checks that the checkout exports each one and proves each resolves inside it. It writes one untracked Deno config and runs every child under that config, including the test-queue wrapper. It then refuses the run if `deno.json` or `deno.lock` changed. [`local_design_system_test.ts`](../../../tests/local_design_system_test.ts) ties the export set to the specifiers every CLI entry graph imports; the entry modules sit beside the set in `LOCAL_DESIGN_SYSTEM_SURFACES`, and `check` type-checks the same entries plus the desk subtree. It also keeps the helpers' own module graphs free of the package, so they still load under the pin after discern adopts an API only the linked checkout has.

Source launchers take the config as an explicit parameter, never an environment variable: `engineRunArgs` and `repoSourceRunArgs`, `runDeskTty`, the capture compiler, and the application fixture. `scripts/desk_capture.ts` and `terminal:capture` accept `--config <path>`. Each launcher refuses a child config that would load a different package build from the process launching it, so a test or capture never projects one build's output with another's parser. A suite that launches the desk in a PTY therefore needs its launcher to pass the config; run such journeys through `capture`. [`source_launch_config_test.ts`](../../../tests/source_launch_config_test.ts) holds the launchers.

Local runs are visual and integration evidence for the package change. The gate, and any Proof, still run against the exact published pin.
