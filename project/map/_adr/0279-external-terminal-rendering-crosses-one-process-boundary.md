# ADR 0279: External terminal rendering crosses one Discern-owned process boundary

**Status**: accepted. Extends the independent package boundary in [ADR 0139](0139-the-design-system-is-an-independent-package.md) and the semantic grouping contract in [ADR 0250](0250-discern-managed-human-output-declares-semantic-groups.md).

## Context

The independent design-system package now exposes a pure `./cli` graph and an effectful `./cli/interactive` graph. Pure renderers accept explicit terminal capabilities and return strings. Interactive primitives put raw terminal effects behind an injectable input/output interface. Neither graph knows Discern's process, repository, product vocabulary, stream ownership, or result contracts.

Discern has the inverse responsibilities. It knows the global `--no-color` flag, terminal attachment, TERM and locale facts, dimensions, product semantics, and whether a fact came from a branch, path, subprocess, Proof, project label, or user. Some of those values are untrusted terminal data. Machine JSON and Model Context Protocol output must stay byte-stable, while raw child output remains a separate byte contract.

Consuming a sibling checkout would make an unpublished tree look like package evidence. Copying ANSI, Unicode width, or prompt machinery would create two quiet design systems. Migrating every output family and prompt in one change would instead couple unrelated renderers and make the shared boundary difficult to review.

## Decision

Discern consumes the exact published `@discern-sh/design-system@0.12.2` release through its configured alias. Consumer tests exercise the root, `./cli`, and `./cli/interactive` exports and inspect Deno's resolved graph. They require the configured pin, lock entry, and resolved package modules to name the same version; the CLI-only graph may contain neither a React runtime nor a package checkout filesystem path. A local path, cache substitution, or unpublished tag is never predecessor evidence.

The package owns reusable Component rendering, generic ANSI stripping, grapheme measurement, truncation, padding and wrapping, terminal themes and semantic Token roles, and reusable interaction machinery. A generic gap is fixed and released upstream rather than copied into Discern.

[`src/lib/terminal.ts`](../../../src/lib/terminal.ts) is Discern's sole process adapter. From explicit injectable inputs it resolves the global no-colour policy, effective package environment, terminal attachment, CI static-output policy, TERM and locale capabilities, one console-size observation with environment fallbacks, the selected package theme, and semantic role helpers. It also converts untrusted product values into visibly escaped single-line or explicitly multi-line Component props. It never alters raw child-process bytes.

Character repertoire, ANSI styling, and ANSI cursor control are independent capabilities. UTF-8 output keeps Unicode under `TERM=dumb`, `NO_COLOR`, and redirection; exact `C` or `POSIX` requests ASCII. A non-TTY or `TERM=dumb` output receives no cursor controls. The public package painter measures each complete frame against the supplied viewport and returns a typed, write-free refusal when replacement is unavailable. Before withholding ordinary output, discern checks that the Gate can repaint; a later refusal stops repainting and leaves one static completion. `TerminalContext` remains a snapshot. A caller may inject a later viewport observation, but the boundary does not claim live resize observation.

[`src/lib/text.ts`](../../../src/lib/text.ts) is the product convenience façade over public package text functions. Discern retains only behavior the package does not own: hanging indents, its explicit long-token overflow policy, content-shaped aligned reports, terminal-size convenience calls, sparklines, and meter data projection. [`src/lib/prompts.ts`](../../../src/lib/prompts.ts) is the sole interactive product choke point and maps Discern policy and semantic groups into the public package prompts.

Discern owns product semantics, safe untrusted-data adaptation, effect and stream routing, JSON and Model Context Protocol contracts, child lifecycle, and composition. `Out` and `Logger` are channel/group/effect adapters, not palette authorities. `@cliffy/command` remains the sole direct Cliffy root and the command parser. Discern has no direct `@cliffy/prompt`, `@cliffy/ansi/colors`, or `@cliffy/table` alias or authored import. Command 1.2.1 owns a transitive Table 1.2.1 node, so its lock, license-cache, and notice records remain only inside the graph-derived command closure.

A Git-derived permanent outlaw scans every authored Deno source for language-agnostic terminal violations and every authored TypeScript source for TypeScript-only member shapes. It rejects new presentation roots, direct prompt/painter bypasses, feature-local capability policy, copied generic text or triangle authorities, palette/prefix APIs, raw terminal controls, and statically provable unsafe Component props. Exact product/machine exceptions name their authority, reason, and occurrence count; stale, moved, or increased populations fail.

## Consequences

- A later renderer receives explicit capabilities, dimensions, theme roles, and safe product text without reading the process, choosing a palette, or measuring a grapheme.
- Pure tests inject facts instead of mutating environment state or manufacturing a terminal.
- Package release coordination is now part of fixing generic terminal behavior. Discern cannot patch around a release with a sibling import.
- Package measurement semantics are authoritative. A generic discrepancy is raised upstream instead of preserving a second local width table.
- Oversized Gate frames and those without cursor control stay static for ordinary terminal scrolling; a presentation write failure cannot change the Gate result or trigger speculative cursor cleanup.
- The staged compatibility palette has reached zero and is permanently illegal. Product conveniences remain only where their policy is not generic package behavior.
- Result schemas, action legality, output routes, raw child bytes, and machine projections remain Discern contracts even when their human presentation uses package Components.

## Alternatives considered

- **Resolve the package from its sibling source checkout.** Rejected because it proves local state rather than the immutable artifact users install.
- **Copy package primitives into Discern.** Rejected because Token values, ANSI behavior, Unicode width, and interaction cleanup would drift behind apparently compatible APIs.
- **Let the package read environment and streams.** Rejected because reusable renderers would lose purity and Discern could not inject one global process decision.
- **Migrate every renderer and prompt immediately.** Rejected because it would combine the architectural seam with several independent product-output changes and force parallel streams through the same shared files.
