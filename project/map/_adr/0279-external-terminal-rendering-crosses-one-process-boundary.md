# ADR 0279: External terminal rendering crosses one Discern-owned process boundary

> **Adaptive-theme amendment (2026-08-15):** The process boundary asks the published interactive package to sense a coloured TTY background once, with a 100ms timeout, and gives later interactions the same process IO identity. `--theme light` and `--theme dark` bypass sensing, while `--theme auto` selects the sensed variant and retains dark as the unknown fallback. Machine, CI-static, colourless, and non-TTY paths never probe.

> **Projection amendment (2026-08-15):** Discern now consumes the immutable 0.15.0 release. Its public `./cli/projection` graph decodes package-emitted terminal styles and renders self-contained HTML for review; Discern carries no local escape parser.

> **Amended 2026-08-14:** `TerminalContext` now exposes command-owned viewport observation. A frame made unsafe by shrink is never erased with guessed cursor geometry.

> **Presenter-contract amendment (2026-08-15):** Discern now consumes the immutable 0.15.0 release. One bound presenter carries capabilities, theme, and default width from the process boundary to every package renderer. The package's narration verbs own the line markers and semantic tones. Per-call widths remain explicit props, and Discern retains stream routing and boundary accounting.

> **Component-contract amendment (2026-08-14):** Search defaults cross the boundary as stable IDs; interaction height, Heading leading lines, Confirm geometry, choice markers, step triangles, Result-summary alignment, and Command suggestion grammar remain package contracts. Terminal value operations use `request*`; their shared contracts use `Interaction*`.

**Status**: accepted. Extends the independent package boundary in [ADR 0139](0139-the-design-system-is-an-independent-package.md) and the semantic grouping contract in [ADR 0250](0250-discern-managed-human-output-declares-semantic-groups.md).

## Context

The independent design-system package now exposes a pure `./cli` graph, an effectful `./cli/interactive` graph, and a pure `./cli/projection` graph. Pure renderers accept explicit terminal capabilities and return strings. Interactive primitives put raw terminal effects behind an injectable input/output interface. Projection decodes the package's emitted style repertoire into typed spans and self-contained HTML. None of these graphs knows Discern's process, repository, product vocabulary, stream ownership, or result contracts.

Discern has the inverse responsibilities. It knows the global `--no-color` flag, terminal attachment, TERM and locale facts, dimensions, product semantics, and whether a fact came from a branch, path, subprocess, Proof, project label, or user. Some of those values are untrusted terminal data. Machine JSON and Model Context Protocol output must stay byte-stable, while raw child output remains a separate byte contract.

Consuming a sibling checkout would make an unpublished tree look like package evidence. Copying ANSI, Unicode width, or interaction machinery would create two quiet design systems. Migrating every output family and interaction in one change would instead couple unrelated renderers and make the shared boundary difficult to review.

## Decision

Discern consumes the exact published `@discern-sh/design-system@0.15.0` release through its configured alias. Consumer tests exercise the root, `./cli`, `./cli/interactive`, and `./cli/projection` exports and inspect Deno's resolved graph. They require the configured pin, lock entry, and every module in each public closure to name the same immutable JSR origin and version; the CLI-only graphs may contain neither a React runtime nor a package checkout filesystem path. A local path, workspace override, source import, mixed-version graph, cache substitution, or unpublished tag is never predecessor evidence.

The package owns reusable Component rendering, generic ANSI stripping, grapheme measurement, truncation, padding and wrapping, terminal themes and semantic Token roles, and reusable interaction machinery. A generic gap is fixed and released upstream rather than copied into Discern.

The package also owns projection of its emitted Select Graphic Rendition (SGR) and Operating System Command (OSC) hyperlink repertoire. Discern may select terminal transcript boundaries and normalise volatile product facts, carriage-return line endings, and platform wrapper artifacts, but it does not parse or reinterpret escape sequences. Unsupported controls fail projection visibly.

[`src/lib/terminal.ts`](../../../src/lib/terminal.ts) is Discern's sole process adapter. From explicit injectable inputs it resolves the global colour-suppression policy, effective package environment, terminal attachment, CI static-output policy, TERM and locale capabilities, an initial console-size observation with environment fallbacks, the selected package theme, and semantic role helpers. In `auto` mode, the package senses once, only when input and output are TTYs, colour is active, and human output is live. Its 100ms query is process-cached; the same IO identity reaches later package requests so deferred reads cannot strand input. Explicit variants skip sensing, and unknown or failed readings select dark. `--no-color` and `NO_COLOR` skip sensing and retain the dark fallback; explicit variants remain selected because spacing or attributes may differ. It also converts untrusted product values into visibly escaped single-line or explicitly multi-line Component props. It never alters raw child-process bytes.

`TerminalContext.observeViewport()` binds the same injected reader to one command. The Gate controller samples it with its repaint ticker and closes both on every exit, refusal, or write fault. Failed reads retain the last size. The terminal guard rejects other process observers.

Character repertoire, ANSI styling, and ANSI cursor control are independent capabilities. UTF-8 output keeps Unicode under `TERM=dumb`, `NO_COLOR`, and redirection. Exact `C` or `POSIX` requests ASCII. A non-TTY or `TERM=dumb` output receives no cursor controls. The public package painter measures each rendered, newline-bearing candidate against the supplied viewport and returns a typed, write-free refusal when replacement is unavailable.

The shared `done` and `prepare` controller tries full, compact, then append-only output; `test` uses the same grammar with Test facts. Growth can restore full mode. Shrink re-evaluates immediately. If the current frame exceeds the viewport, refusal latches append-only output with no erase. The deferred transcript, final table, result tail, and Proof follow once. Write failure stops presentation without changing the result.

[`src/lib/text.ts`](../../../src/lib/text.ts) is the product convenience façade over public package text functions. Discern retains only behavior the package does not own: hanging indents, its explicit long-token overflow policy, content-shaped aligned reports, terminal-size convenience calls, sparklines, and meter data projection. [`src/lib/terminal_interaction.ts`](../../../src/lib/terminal_interaction.ts) is the sole interactive product choke point and maps Discern policy and semantic groups into public package requests. Discern's wrapper names follow the same `request*` and `Interaction*` contract; neither package nor product adapter carries compatibility aliases for the old terminal-input dialect. Interaction viewports respond to observed terminal height, and the caller's visible-row budget remains a hard ceiling. A composed choice request forwards its caller-recorded `reservedRows` unchanged. The package fitter subtracts that reservation from the live viewport and measures the complete frame, including label, borders, hints, lifecycle state, and choices. For searchable defaults, the adapter maps a caller-owned value through the existing stable-choice-ID authority, rejects an unmatched value, and passes the public `initialId`. The docs browser owns one remembered document only for the lifetime of its browse loop.

Static Component contracts cross the same boundary without local replicas. Calm Heading owns one leading line by default; an embedded use asks for zero and lets Discern's semantic output layer own the transition ([ADR 0250](0250-discern-managed-human-output-declares-semantic-groups.md)). Confirm geometry does not shift with state, selected choices carry the package marker, and completed and incomplete workflow steps use the package's upward and downward status directions. Mixed Result summaries use the package group compositor for aligned fact columns. Command suggestions retain their command value but render with `Run:` and no shell prefix.

Discern owns product semantics, safe untrusted-data adaptation, effect and stream routing, JSON and Model Context Protocol contracts, child lifecycle, and composition. `Out` and `Logger` are channel/group/effect adapters, not palette authorities. `@cliffy/command` remains the sole direct Cliffy root and the command parser. Discern has no direct `@cliffy/prompt`, `@cliffy/ansi/colors`, or `@cliffy/table` alias or authored import. Command 1.2.1 owns a transitive Table 1.2.1 node, so its lock, license-cache, and notice records remain only inside the graph-derived command closure.

A Git-derived permanent outlaw scans every authored Deno source for language-agnostic terminal violations and every authored TypeScript source for TypeScript-only member shapes. It rejects new presentation roots, direct request/painter bypasses, package terminal IO construction outside the process adapter, feature-local capability policy, capability re-spreads, direct theme threading, copied generic text or triangle authorities, palette/prefix APIs, raw terminal controls, and statically provable unsafe Component props. Pure rendering uses the presenter bound at the process boundary; the effectful interaction graph's one theme handoff is an exact counted exception because package requests do not consume the pure presenter. The guard also reserves prompt vocabulary in the terminal-interaction authority for coding-agent instructions. Exact product/machine exceptions name their authority, reason, and occurrence count; stale, moved, or increased populations fail.

## Consequences

- A later renderer receives explicit capabilities, dimensions, theme roles, and safe product text without reading the process, choosing a palette, or measuring a grapheme.
- Pure tests inject facts instead of mutating environment state or manufacturing a terminal.
- Package release coordination is now part of fixing generic terminal behavior. Discern cannot patch around a release with a sibling import.
- Package measurement semantics are authoritative. A generic discrepancy is raised upstream instead of preserving a second local width table.
- Gate-family commands retain progress at tall and compact heights, then fall back to ordinary scrolling. No observer or ticker survives completion.
- Unsafe shrink and write failure are one-way latches: no guessed cleanup or later presentation attempt can change the Gate result.
- The staged compatibility palette has reached zero and is permanently illegal. Product conveniences remain only where their policy is not generic package behavior.
- Result schemas, action legality, output routes, raw child bytes, and machine projections remain Discern contracts even when their human presentation uses package Components.
- Review artifacts preserve the package's terminal styles through its published typed-span and HTML projection instead of a Discern-owned decoder.

## Alternatives considered

- **Resolve the package from its sibling source checkout.** Rejected because it proves local state rather than the immutable artifact users install.
- **Copy package primitives into Discern.** Rejected because Token values, ANSI behavior, Unicode width, and interaction cleanup would drift behind apparently compatible APIs.
- **Let the package read environment and streams.** Rejected because reusable renderers would lose purity and Discern could not inject one global process decision.
- **Keep the initial viewport for the full command.** Rejected because a terminal can change height while a job runs. The live reader belongs at the existing process boundary, while pure renderers continue receiving explicit dimensions.
- **Migrate every renderer and interaction immediately.** Rejected because it would combine the architectural seam with several independent product-output changes and force parallel streams through the same shared files.
