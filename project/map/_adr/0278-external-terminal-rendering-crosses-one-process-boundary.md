# ADR 0278: External terminal rendering crosses one Discern-owned process boundary

**Status**: accepted. Extends the independent package boundary in [ADR 0139](0139-the-design-system-is-an-independent-package.md) and the semantic grouping contract in [ADR 0250](0250-discern-managed-human-output-declares-semantic-groups.md).

## Context

The independent design-system package now exposes a pure `./cli` graph and an effectful `./cli/interactive` graph. Pure renderers accept explicit terminal capabilities and return strings. Interactive primitives put raw terminal effects behind an injectable input/output interface. Neither graph knows Discern's process, repository, product vocabulary, stream ownership, or result contracts.

Discern has the inverse responsibilities. It knows the global `--no-color` flag, terminal attachment, TERM and locale facts, dimensions, product semantics, and whether a fact came from a branch, path, subprocess, Proof, project label, or user. Some of those values are untrusted terminal data. Machine JSON and Model Context Protocol output must stay byte-stable, while raw child output remains a separate byte contract.

Consuming a sibling checkout would make an unpublished tree look like package evidence. Copying ANSI, Unicode width, or prompt machinery would create two quiet design systems. Migrating every output family and prompt in one change would instead couple unrelated renderers and make the shared boundary difficult to review.

## Decision

Discern consumes one exact published `@discern-sh/design-system` release through its configured alias. Consumer tests exercise the root, `./cli`, and `./cli/interactive` exports and inspect Deno's resolved graph. They require the configured pin, lock entry, and resolved package modules to name the same version; the CLI-only graph may contain neither a React runtime nor a package checkout filesystem path. A local path, cache substitution, or unpublished tag is never predecessor evidence.

The package owns reusable Component rendering, generic ANSI stripping, grapheme measurement, truncation, padding and wrapping, terminal themes and semantic Token roles, and reusable interaction machinery. A generic gap is fixed and released upstream rather than copied into Discern.

[`src/lib/terminal.ts`](../../../src/lib/terminal.ts) is Discern's sole process adapter. From explicit injectable inputs it resolves the global no-colour policy, effective package environment, terminal attachment, TERM and locale capabilities, one console-size observation with environment fallbacks, the selected package theme, and semantic role helpers. It also converts untrusted product values into visibly escaped single-line or explicitly multi-line Component props. It never alters raw child-process bytes.

[`src/lib/text.ts`](../../../src/lib/text.ts) remains a compatibility façade while feature streams migrate. Its generic operations delegate to public package functions. Discern retains only behavior the package does not own: hanging indents, its explicit long-token overflow policy, content-shaped aligned tables, terminal-size convenience calls, sparklines, and meter data projection. [`src/lib/prompts.ts`](../../../src/lib/prompts.ts) remains the sole interactive product choke point.

Discern owns product semantics, safe untrusted-data adaptation, effect and stream routing, JSON and Model Context Protocol contracts, child lifecycle, and composition. `@cliffy/command` remains the command parser. The three Cliffy presentation dependencies remain temporarily until their caller families migrate. Untouched feature renderers may use a raw-prefix compatibility façade only through `src/engine/output.ts`; its members derive from package Token roles and have an exact census scheduled for removal in adoption 3A.

## Consequences

- A later renderer receives explicit capabilities, dimensions, theme roles, and safe product text without reading the process, choosing a palette, or measuring a grapheme.
- Pure tests inject facts instead of mutating environment state or manufacturing a terminal.
- Package release coordination is now part of fixing generic terminal behavior. Discern cannot patch around a release with a sibling import.
- Package measurement semantics are authoritative. A generic discrepancy is raised upstream instead of preserving a second local width table.
- The compatibility façade keeps staged feature migrations disjoint, but its census is deliberate debt and later streams must reduce it.
- This foundation changes no result schema, action legality, output route, raw child contract, or feature-family frame. Visual and prompt migrations remain separate work.

## Alternatives considered

- **Resolve the package from its sibling source checkout.** Rejected because it proves local state rather than the immutable artifact users install.
- **Copy package primitives into Discern.** Rejected because Token values, ANSI behavior, Unicode width, and interaction cleanup would drift behind apparently compatible APIs.
- **Let the package read environment and streams.** Rejected because reusable renderers would lose purity and Discern could not inject one global process decision.
- **Migrate every renderer and prompt immediately.** Rejected because it would combine the architectural seam with several independent product-output changes and force parallel streams through the same shared files.
