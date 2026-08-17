---
aliases:
  - "@discern-sh/design-system"
  - design system dependency
  - component bundles
  - runtime emitter
---

# The published design-system dependency

discern consumes `@discern-sh/design-system` from the JavaScript Registry (JSR) at an exact version. The [discern-sh/design-system](https://github.com/discern-sh/design-system) repository authors and releases the package. This repository owns the discern.sh integration and product compositions.

## Dependency boundary

The root `deno.json` exposes one stable alias:

```json
"discern-design-system": "jsr:@discern-sh/design-system@0.20.0"
```

Site imports use only that package root and its documented `./runtime` and `./react` exports. The CLI and its consumer proof additionally use the documented `./cli`, `./cli/interactive`, `./cli/interactive/testing`, and `./cli/projection` exports. `deno.lock` records the same release. Those public exports are the complete consumer application programming interface (API); source trees, registry addresses, cache internals, distribution files, workspace links, and sibling checkouts remain internal.

When a package defect affects discern, release the fix from the package repository and update this repository to the new exact version. Package source remains in its own repository. The temporary minimum-age exception in `deno.json` names this exact package because the cutover happened during Deno's registry holding period. Every other dependency remains subject to the normal age policy.

## CLI-owned integration

The package's `./cli` graph owns Components, Tokens, layout, motifs, and separate repertoire, style, and cursor-control facts. Its `./cli/interactive` graph owns input, value requests, and safe repaint refusal. Its `./cli/projection` graph turns package-emitted styles into typed spans and self-contained review HTML. Process, safe-text, product, effect, stream, machine, raw-child, and artwork authority remain with discern through [`terminal.ts`](../../../src/lib/terminal.ts) and [`terminal_interaction.ts`](../../../src/lib/terminal_interaction.ts).

Consumer conformance proves the package root and every CLI graph are React-free where required. Every package-owned module resolves from the immutable `https://jsr.io/@discern-sh/design-system/0.20.0/` origin; an external npm root must be declared by that published package and resolve to an exact node in `deno.lock`. A local path, workspace override, source import, mixed version, unlocked parser, or sibling checkout cannot satisfy the guard. Cliffy's Command package remains a separate parser boundary. No direct Cliffy presentation dependency or import remains in discern; Command's package-owned transitive Table node remains in the lock and notices only as part of the derived parser closure ([ADR 0279](../_adr/0279-external-terminal-rendering-crosses-one-process-boundary.md)).

## Release 0.19.0 Markdown contracts

Release 0.19.0 makes Markdown a first-class Editorial Component. Its public React-free `renderMarkdownCli` renderer owns CommonMark, GitHub Flavored Markdown tables, task lists, deleted text and automatic links, GitHub alerts, and footnotes through one pinned parser and exhaustive package model. Paragraph, Heading, List, Blockquote, `Callout`, Code block, Divider, Table, and Footnotes remain the presentation authorities. The renderer preserves nested structure and targets under narrow measures, makes hostile controls visible, leaves unsafe destinations non-actionable, and follows the bound theme, motif, colour, Unicode, and hyperlink capabilities. The same release measures Recommended for General Interchange emoji-presentation sequences, including flags and digit symbols, as two terminal cells while ordinary text pictographs retain their East Asian Width.

## Release 0.20.0 reader contracts

Release 0.20.0 adds secondary descriptions to choices and group headings, searching across labels and descriptions, a quieter browsing presentation, successful-frame cleanup policies, and a compact acknowledgement. Its public interactive graph also supplies the adaptive Markdown browser, internal-link navigation, mouse input, typed capability refusals, and terminal restoration needed by the integrated reader. The 5A `discern` browser consumes the selection and continuation contracts; the composite Markdown browser remains package-owned when discern adopts it.

[`src/lib/markdown.ts`](../../../src/lib/markdown.ts) is the compatibility adapter for terminal readers. `discern map` and `discern docs` pass source plus their resolved measure through the process-bound presenter and carry no local terminal grammar. [`tests/markdown_test.ts`](../../../tests/markdown_test.ts) requires the adapter to remain byte-for-byte the public package renderer over the downstream dialect fixture and explicit colour, width, and repertoire cases. Raw, export, JSON, authored Markdown-result, and Model Context Protocol (MCP) surfaces do not enter this presentation path ([ADR 0287](../_adr/0287-terminal-markdown-delegates-to-the-design-system.md)).

The request-time docs website keeps its React-free, product-specific HTML emitter. Workflow directives, glossary summaries, heading outlines, and link-integrity probes need hooks the generic package API does not expose; that boundary no longer claims to share the terminal parser. The package's browser Markdown Component is therefore not selected into the docs runtime bundle by this release.

## Release 0.18.1 semantic motif contracts

Release 0.18.1 replaces geometry-named triangle foundations with the semantic `TerminalMotif` contract. A validated, immutable motif carries separate Unicode and ASCII repertoires for spinner motion, repeated patterns, an accent marker, and complete/incomplete status. The process boundary explicitly binds the package's `DISCERN_TERMINAL_MOTIF` into one `CliPresenter`; feature renderers call its `motif*` methods with only content and local measures. The selected Unicode spinner for discern is the centered clockwise cycle `▴`, `◂`, `▾`, `▸`, with `^`, `<`, `v`, `>` as its ASCII fallback.

The package default remains suitable for discern without imposing triangle geometry on another consumer. A consumer can derive a validated motif by replacing selected roles, bind it when constructing or deriving a presenter, or pass it to one renderer call. [`art/terminal/triangle.ts`](../../../art/terminal/triangle.ts) is the sole explicit-capability adapter: its reusable gallery entries bind the discern preset to public motif renderers, while the product-only pyramid and recursive gasket project named triangle geometry from the pattern in that preset. It does not render CLI features.

## Release 0.17.0 presenter foundation contracts

Release 0.17.0 first bound box and the then triangle-named spinner, section-rule, and workflow foundations into the CLI presenter alongside Components and narration. It established that feature renderers pass only content and local measures while the process boundary supplies capabilities and theme once. Release 0.18.1 preserves that boundary through semantic motif names and adds the bound motif itself.

## Release 0.16.0 choice contracts

Release 0.16.0 makes scrolling Select, Checkbox, and Radio frames consume the available terminal width unless a caller requests a narrower frame. Wrapped choice labels retain one pointer-and-marker prefix as the highlight moves. Every semantic group heading has one framed blank row above it, and a fitted window states its hidden choices in the lower border, such as `↑ 2 more · ↓ 7 more`. The product adapter supplies only values, semantic groups, visible-row ceilings, and caller reservations, so Desk, map and documentation browsers, improve, and setup inherit the same geometry without command-specific width or overflow code.

## Release 0.15.0 review contracts

Release 0.15.0 publishes `./cli/projection`. It accepts only the style and hyperlink repertoire emitted by the package, returns typed spans, and renders those spans as self-contained HTML under the package terminal theme. Cursor movement, erasure, unsupported controls, and foreign byte streams fail rather than receiving an approximation. This repository owns command capture and volatile-fact normalisation, while the package remains the only terminal-style decoder.

## Release 0.15.0 terminal contracts

Release 0.15.0 carries forward the reviewed terminal behavior from 0.14.0 and adds the bound presenter, narration verbs, truthful validation lifecycle, transform-before-validation requests, terminal-background sensing, and terminal-output projection. One presenter binds capabilities, theme, and default width at the process boundary. Package render calls then carry their content props and any narrower per-call width. The package's interactive graph owns the bounded background query and environment-hint fallback; discern decides when to sense and which theme to select from the reading. Small narration lines use the presenter's semantic success, note, warning, failure, and lead forms while discern continues to own stream routing and group boundaries.

Value operations use `request*`, operation options use `*RequestOptions`, and shared lifecycle contracts use `Interaction*`; “prompt” remains available for coding-agent instructions. The product adapter in discern follows the same names and ships no compatibility aliases. Interaction frames derive their usable viewport from the current terminal height on every render; a caller's visible-count value is a ceiling, so short terminals reduce the list instead of painting beyond the viewport. A caller may also reserve rows above the request. The fitter subtracts that reservation before it measures the complete frame, which prevents a full-budget list from scrolling a composed header away. Search requests accept an initial stable choice ID. [`terminal_interaction.ts`](../../../src/lib/terminal_interaction.ts) maps the caller's product value through its existing stable-ID authority, rejects a value that names no choice, and sends only the resulting ID to the package. The docs browser retains its highlighted document within one browse loop. It does not persist state between command runs.

The same release makes the calm Heading the package default and gives it a configurable leading-line count. Top-level package headings normally keep their one-line default; a heading embedded in a discern-owned composition requests zero so the surrounding semantic group owns the boundary. Confirm keeps fixed frame geometry while its state changes, and selected choices use a distinct selected marker rather than highlight alone. Workflow steps direct their triangle by status: completed steps point upward and incomplete steps point downward.

Mixed Result summaries compose through the package's group renderer, which aligns fact columns across different state prefixes. Patterns and improvement therefore carry no local prefix-padding calculation. Command suggestions render as `Run: <command>` without a shell prefix, preserving the underlying command while keeping suggested future action visually distinct from previously typed shell input.

## Site-owned integration

[`site/design_system.ts`](../../../site/design_system.ts) contains the complete integration. Its `DESIGN_SYSTEM_BUNDLES` table declares:

| Bundle         | Routes                      | Selection                                              | Optional assets |
| -------------- | --------------------------- | ------------------------------------------------------ | --------------- |
| `docs`         | `/docs` and its descendants | Docs, shared chrome, and the 6 rendered Workflow roots | fonts           |
| `compositions` | `/`                         | Marketing, Editorial, and shared display parts         | fonts and grain |

The table also owns the discern theme choice and emitted public directories. [`site/build.ts`](../../../site/build.ts) passes each selection to the public `./runtime` emitter. The package resolves transitive component dependencies and writes deterministic CSS, selection-scoped browser scripts, a manifest, and the requested assets. The discern integration reads those outputs instead of copying the package manifest, tokens, dependency graph, CSS, behavior source, or adapters.

The docs shell loads its smaller bundle from `/assets/design-system/docs/`, including the emitted `discern.js` that promotes Glossary term's Hover card panels above clipping ancestors. The homepage loads the full selected bundle from `/assets/design-system/compositions/`. That selection currently emits no package browser script. Both bundles select fonts. Only the compositions bundle selects grain, and the docs bundle neither emits nor loads it. Generated output stays ignored beneath `site/pages/assets/design-system/`.

The docs bundle selects the `Docs` group plus the shared `icon`, `icon-button`, `theme-toggle`, `brand`, `divider`, `heading`, `kicker`, `table`, `breadcrumbs`, and `table-of-contents` components. Its explicit Workflow roots are `procedure`, `command`, `result-summary`, `path-reference`, `ownership-badge`, and `branch-choice`; the package adds their dependencies in manifest order. A selected Workflow root must appear on a real manual journey, and a rendered root must resolve into this bundle.

Both bundles select the Core `Brand` component, which brings its `Logo` dependency with it. [`site/page-src/branding.tsx`](../../../site/page-src/branding.tsx) owns the canonical public lockup: the decorative `◮`, the visible `discern` name, the `mono` typeface, and an optional context tagline. The docs shell reuses its statically rendered markup, and the homepage can compose its React adapter. The browser receives the component's semantic HTML, selected CSS, and any framework-neutral behavior script declared by that selection, with no React runtime.

The static page boundary, homepage composition, build commands, and manifest-driven consumer guards are recorded separately in [design-system-consumption.md](design-system-consumption.md).
