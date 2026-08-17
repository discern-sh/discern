# ADR 0287: Terminal Markdown delegates to the design system

> **Reader-contract amendment (2026-08-17; [ADR 0290](0290-discern-owns-the-default-interactive-markdown-reading-loop.md)):** Discern now consumes the immutable 0.20.0 release. The release retains the package Markdown renderer and adds the public selection-description, completion, continuation, and composite-browser contracts used by Discern's terminal readers.

**Status**: accepted; supersedes [ADR 0015](./_superseded/0015-map-browser.md)

## Context

`discern map` began with a small hand-written Markdown parser because the binary needed a readable, dependency-light terminal viewer and no package owned the required semantics. That parser later served `discern docs` and grew local handling for headings, prose, inline styling, links, images, rules, code, lists, blockquotes, alerts, and tables. It remained an approximate grammar: reference links, setext headings, loose multi-block lists, footnotes, raw-HTML policy, and pathological-input limits either differed from CommonMark or were absent.

`@discern-sh/design-system` 0.19.0 now publishes the missing authority. Its React-free `./cli` graph parses CommonMark plus the documented GitHub Flavored Markdown, alert, and footnote extensions into one package-owned model, then dispatches every block through public Components. It also owns safe destinations, hostile-control notation, width and depth limits, responsive nested composition, terminal capabilities, themes, and motifs. Retaining Discern's parser would duplicate the grammar and make a generic rendering defect require two fixes.

The browser manual has a different constraint. It renders at request time without React and applies Discern-owned Workflow directives and first-mention glossary cards through product-specific hooks. The package's public Markdown API intentionally exposes neither its parser model nor those hooks, so replacing that path in the same change would require a new static-site architecture or a second package contract.

## Decision

All terminal Markdown documents delegate to the exact published design-system renderer.

- `src/lib/markdown.ts` keeps the source-compatible `renderMarkdown(md, { width, color, terminal })` boundary used by `discern map` and `discern docs`, but the function only resolves Discern's explicit process facts and calls the package's public `renderMarkdownCli` Component.
- The bound `TerminalContext` remains Discern's sole environment boundary. Its capabilities, theme, motif, and effective measure reach Markdown through the package presenter; no Markdown feature reads the process or duplicates a Component.
- A consumer guard compares Discern's wrapper byte-for-byte with the package renderer over the complete downstream dialect fixture, colour postures, and width floor. Package tests own grammar and Component conformance; Discern tests own delegation, its process adapter, and representative product facts.
- `--raw`, `--json`, `--markdown`, Model Context Protocol payloads, and `map --export` retain their existing source or result projections. They do not enter terminal rendering.
- The docs website's React-free HTML emitter, Workflow projections, glossary hooks, heading outline, and integrity helpers remain Discern-owned. They are named as a separate browser boundary rather than described as the terminal parser or as a shared cross-surface grammar.

Discern consumes only the immutable `0.20.0` public exports. A generic Markdown parsing, safety, layout, terminal-style, or interactive-reader defect is fixed and released in the design-system repository before Discern updates its pin; a sibling checkout or copied parser is not an admissible patch.

## Consequences

- `discern map` and `discern docs` gain the package's complete supported dialect, nested lossless layout, semantic Components, safety limits, and deterministic degradation without carrying a second terminal grammar.
- Terminal output changes to the Component-backed document composition. The change therefore requires exact adapter tests plus rendered before-and-after terminal evidence.
- The compiled binary and notices gain the parser stack shipped by the package. The representative Linux x64 artifact measures 167,486,008 bytes, 4,644,744 above the previous ceiling. The owner accepts that release cost and recalibrates the ceiling on the trunk instead of paying ongoing local grammar, safety, and conformance cost.
- Browser and terminal Markdown no longer claim one parser. The website keeps its current product projections and exact HTML contracts until a public package hook or a separately decided build-time projection can replace them without importing React into the production server.
- ADR 0015 remains the history of why the map browser, TTY split, raw view, search, export, and pager exist, but its hand-rolled-renderer decision is superseded.

## Alternatives considered

**Keep the local parser and use package Components only for decoration.** Rejected because syntax, safety, fallback, nesting, and width policy would still have two authorities.

**Import the package from its sibling source checkout.** Rejected because users install an immutable registry artifact; local source state cannot prove that contract.

**Adopt the React Markdown Component in the request-time docs server now.** Rejected because it would put React in the production graph and still provide no Workflow or glossary projection hook. A build-time browser migration is possible, but it is a separate architecture decision rather than a prerequisite for terminal adoption.
