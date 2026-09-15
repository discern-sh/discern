---
aliases:
  - "@discern-sh/design-system"
  - design system dependency
  - component bundles
  - runtime emitter
---

# The design-system dependency

discern uses one exact `@discern-sh/design-system` alias. It resolves to an immutable JavaScript Registry (JSR) release through the committed Deno lock. Ordinary commands need no package checkout. The [discern-sh/design-system](https://github.com/discern-sh/design-system) repository authors and releases the package. This repository owns the discern.sh integration and product compositions.

## Dependency boundary

The root `deno.json` exposes one stable alias:

```json
"discern-design-system": "jsr:@discern-sh/design-system@0.33.0"
```

Site imports use only that package root and its documented `./runtime` and `./react` exports. The CLI and its consumer Proof additionally use the documented `./cli`, `./cli/interactive`, `./cli/interactive/testing`, and `./cli/projection` exports. The docs site's fenced-code renderer uses the same projection export. `deno.lock` records the release integrity and its transitive dependencies. Those public exports are the complete consumer application programming interface (API); source paths, registry addresses, cache internals and distribution files never appear in consumer imports. Committed local dependency overrides are rejected.

Package defects are fixed, proved and formally released in the package repository before discern adopts the new exact version. Package source remains in its own repository. The temporary minimum-age exception in `deno.json` names this exact package because the cutover happened during Deno's registry holding period. Every other dependency remains subject to the normal age policy.

## Local package iteration

Use the `site-design-system` Project Script to review changes that span both repositories before publication. With the standard sibling checkouts, run it without arguments:

```sh
discern scripts site-design-system
```

The script derives Git's main discern checkout and selects the sibling design-system repository, including when the command runs from a linked discern worktree. It validates the package name, semantic version, and the root, React, and Runtime exports. It creates a temporary copy of discern's Deno configuration, aligns only that copy's package alias with the selected checkout's declared version, and links the checkout there. This lets Deno accept an ahead or behind local package while the committed exact JSR pin remains unchanged. The temporary configuration has no lockfile or `node_modules` directory. Before building, the script proves that the public Runtime export resolves from the selected checkout rather than JSR.

The script serves the normal site on this worktree's assigned port. Its watcher covers discern's site inputs, the linked package's `src/` tree, and its `deno.json`. Every rebuild uses the same temporary configuration. Stopping the script removes that configuration. The script also verifies that the committed `deno.json` and `deno.lock` remained unchanged.

Use a one-shot build when another process already serves the generated site:

```sh
discern scripts site-design-system -- --build-only
```

Pass an absolute checkout path after the script name to override the sibling checkout. The local link provides visual and integration evidence only. Ordinary builds and gates use the committed immutable dependency. Follow the [package adoption procedure](../80-development/terminal-applications.md#package-source-and-releases) before changing that pin.

## CLI-owned integration

The package's `./cli` graph owns Components, Tokens, layout, motifs, and separate repertoire, style, and cursor-control facts. Its `./cli/interactive` graph owns input, value requests, and safe repaint refusal. Its `./cli/projection` graph turns package-emitted styles into typed spans and self-contained review HTML. [`terminal.ts`](../../../src/lib/terminal.ts) binds the shared product-blue hue as an explicit terminal Appearance independently from its light/dark ground; [`terminal_interaction.ts`](../../../src/lib/terminal_interaction.ts) carries the same immutable facts into effectful requests. Process, safe-text, product, effect, stream, machine, raw-child, and artwork authority remain with discern at those boundaries.

Consumer conformance proves the package root and every CLI graph are React-free where required. Every package-owned module resolves inside the selected release’s registry origin; an external npm root must be declared by the package and resolve to an exact node in `deno.lock`. Mixed origins, local overrides, source imports, unlocked parsers and testing modules in ordinary graphs cannot satisfy the guards. Cliffy's Command package remains a separate parser boundary. No direct Cliffy presentation dependency or import remains in discern; Command's package-owned transitive Table node remains in the lock and notices only as part of the derived parser closure ([ADR 0279](../_adr/0279-external-terminal-rendering-crosses-one-process-boundary.md)).

## Release 0.23.0 declaration contract

Release 0.23.0 adds the neutral Result-summary state `declared`. Its terminal label is `Declared`, with `·` as the Unicode marker and `.` as the ASCII marker. Checkpoint conclusions use this state to name agent evidence without presenting the declaration as machine success, failure, or change currency; an unmet conclusion carries owner attention and variance as separate product facts.

## Releases 0.24.0 through 0.30.1 catalogue, projection, chart, verification, navigation, and Appearance contracts

Release 0.24.0 adds reading-first Marketing Components and a Catalogue builder. Release 0.25.0 renames the browser Artwork `Ground` vocabulary to `Backdrop` and adds Tiling, Compression, and Harmonic Backdrops. Release 0.26.0 adds the Editorial `Diagram` Component and the public `./diagram` API for flow, architecture, cycle, sequence, and timeline specifications. It also publishes `projectTerminalTextRuns()`, which assigns the package's terminal width to each non-ASCII grapheme while leaving the source text unchanged. Release 0.26.1 makes the package's browser alignment verification independent of font ink overhang. Release 0.27.0 adds the public `./chart` API, the Editorial Chart Component, the Display Sparkline Component, and lossless terminal reflow for DataFigure. Release 0.28.0 renames the package-neutral terminal verification Component to `VerificationReport`; discern maps its product-owned Proof and other evidence views into that public contract. Release 0.29.0 gives Docs navigation explicit current-page and current-location semantics while retaining boolean compatibility. Release 0.30.1 makes every surface default monochrome, replaces the removed browser runtime `theme` selection with optional Appearance scopes, and stamps that choice into runtime-manifest schema 4. The browser roots and terminal presentation boundaries activate the shared blue Accent explicitly; terminal `theme` continues to select only the light/dark ground, and discern's product-level terminal choice does not change.

The docs site's React-free Markdown renderer passes fenced code through `projectTerminalTextRuns()`. It escapes each run into the existing `<code>` element and uses fixed-width inline boxes for measured graphemes. The bundled JetBrains Mono face can therefore fall back for CJK, emoji, and box-drawing glyphs without moving later terminal cells; `textContent`, `innerText`, and the copy control still expose the source text. The site selects package Groups and receives the expanded browser catalogue through the existing runtime emitter. The CLI graphs, terminal process boundary, and interaction choke point retain their contracts.

## Release 0.22.0 presentation contracts

Release 0.22.0 gives Toast and shared Forms frames balanced horizontal padding and omits routine derived lifecycle tokens from labels. Search retains its pending signal, while callers can request explicit diagnostic status through `showStatus`. Meter, Badge, Activity log, Section, and Procedure receive package-owned presentational refinements without changing discern's product data or effect boundaries. Real-TTY tests synchronize input from the authored request label rather than optional lifecycle decoration.

The package registry now includes Layout `Masonry`. The compositions bundle selects the Marketing group and therefore carries `FeatureBento` runtime assets. No discern page renders a `FeatureBento` instance, so its strict rectangular tiling contract has no product call site here.

## Release 0.19.0 Markdown contracts

Release 0.19.0 makes Markdown a first-class Editorial Component. Its public React-free `renderMarkdownCli` renderer owns CommonMark, GitHub Flavored Markdown tables, task lists, deleted text and automatic links, GitHub alerts, and footnotes through one pinned parser and exhaustive package model. Paragraph, Heading, List, Blockquote, `Callout`, Code block, Divider, Table, and Footnotes remain the presentation authorities. The renderer preserves nested structure and targets under narrow measures, makes hostile controls visible, leaves unsafe destinations non-actionable, and follows the bound theme, motif, colour, Unicode, and hyperlink capabilities. The same release measures Recommended for General Interchange emoji-presentation sequences, including flags and digit symbols, as two terminal cells while ordinary text pictographs retain their East Asian Width.

## Release 0.21.0 terminal contracts

Release 0.21.0 derives Unicode repertoire from the locale declaration alone. An undeclared locale and bare language tags use Unicode; exact `C` or `POSIX` and explicitly non-UTF-8 character sets use ASCII. Terminal attachment governs cursor and control behavior. Locale governs character repertoire. Agent shells and redirected output therefore retain Unicode glyphs, including `◮` where a composition selects the brand register, unless they explicitly declare an ASCII-only locale.

The discern motif now has a plain register for ambient interface grammar and a brand register for ceremonial identity. Plain rendering uses `▲`, `△`, and `▲ ▷ ▼ ◁`; the brand register preserves `◮` and `◮ ⧩ ◭ ⧨`. Logo and Brand select the brand register by default. The product-owned pyramid and recursive gasket also derive their geometry from that register. Meter heads, Fleet, `Worklog`, and Process steps beacons, and Window and Terminal marks have fixed directional geometry and do not follow a consumer-selected motif register. Gate, improvement, Logbook, and status section rules select the brand register at their product composition call sites. Command mastheads and structured Procedures do the same, while picker and navigation groups and other reusable package motifs retain their plain default.

The terminal Switch omits Yes and No text by default and uses symmetric glyph-only geometry. discern's confirmation adapter requires each product call to supply short action labels through the package contract, so the surrounding question carries the scope while both Switch sides name their effect.

## Release 0.20.0 reader contracts

Release 0.20.0 adds secondary descriptions to choices and group headings, searching across labels and descriptions, a quieter browsing presentation, successful-frame cleanup policies, and a compact acknowledgement. Its public interactive graph also supplies the adaptive Markdown browser, internal-link navigation, mouse input, typed capability refusals, and terminal restoration needed by the integrated reader. The 5A `discern` browser consumes the selection and continuation contracts; the composite Markdown browser remains package-owned when discern adopts it.

[`src/lib/markdown.ts`](../../../src/lib/markdown.ts) is the compatibility adapter for terminal readers. `discern map` and `discern docs` pass source plus their resolved measure through the process-bound presenter and carry no local terminal grammar. [`tests/markdown_test.ts`](../../../tests/markdown_test.ts) requires the adapter to remain byte-for-byte the public package renderer over the downstream dialect fixture and explicit colour, width, and repertoire cases. Raw, export, JSON, authored Markdown-result, and Model Context Protocol (MCP) surfaces do not enter this presentation path ([ADR 0287](../_adr/0287-terminal-markdown-delegates-to-the-design-system.md)).

The request-time docs website keeps its React-free, product-specific HTML emitter. Workflow directives, glossary summaries, heading outlines, and link-integrity probes need hooks the generic package API does not expose; that boundary does not share the terminal parser. Fenced code delegates grapheme width to the package's plain-text projection without adopting the package's React Markdown Component.

## Release 0.18.1 semantic motif contracts

Release 0.18.1 replaces geometry-named triangle foundations with the semantic `TerminalMotif` contract. A validated, immutable motif carries separate Unicode and ASCII repertoires for spinner motion, repeated patterns, an accent marker, and complete/incomplete status. The process boundary explicitly binds the package's `DISCERN_TERMINAL_MOTIF` into one `CliPresenter`; feature renderers call its `motif*` methods with only content and local measures. The selected Unicode spinner for discern is the centered clockwise cycle `▴`, `◂`, `▾`, `▸`, with `^`, `<`, `v`, `>` as its ASCII fallback.

The package default remains suitable for discern without imposing triangle geometry on another consumer. A consumer can derive a validated motif by replacing selected roles, bind it when constructing or deriving a presenter, or pass it to one renderer call. [`art/terminal/triangle.ts`](../../../art/terminal/triangle.ts) is the sole explicit-capability adapter: its reusable gallery entries bind the discern preset to public motif renderers, while the product-only pyramid and recursive gasket project named triangle geometry from the pattern in that preset. It does not render CLI features.

## Release 0.17.0 presenter foundation contracts

Release 0.17.0 first bound box and the then triangle-named spinner, section-rule, and workflow foundations into the CLI presenter alongside Components and narration. It established that feature renderers pass only content and local measures while the process boundary supplies capabilities and theme once. Release 0.18.1 preserves that boundary through semantic motif names and adds the bound motif itself.

## Release 0.16.0 choice contracts

Release 0.16.0 makes scrolling Select, Checkbox, and Radio frames consume the available terminal width unless a caller requests a narrower frame. Wrapped choice labels retain one pointer-and-marker prefix as the highlight moves. Every semantic group heading has one framed blank row above it, and a fitted window states its hidden choices in the lower border, such as `↑ 2 more · ↓ 7 more`. The product adapter supplies only values, semantic groups, visible-row ceilings, and caller reservations, so desk, map and documentation browsers, improve, and setup inherit the same geometry without command-specific width or overflow code.

## Release 0.15.0 review contracts

Release 0.15.0 publishes `./cli/projection`. It accepts only the style and hyperlink repertoire emitted by the package, returns typed spans, and renders those spans as self-contained HTML under the package terminal theme. Cursor movement, erasure, unsupported controls, and foreign byte streams fail rather than receiving an approximation. This repository owns command capture and volatile-fact normalisation, while the package remains the only terminal-style decoder.

## Release 0.15.0 terminal contracts

Release 0.15.0 carries forward the reviewed terminal behavior from 0.14.0 and adds the bound presenter, narration verbs, truthful validation lifecycle, transform-before-validation requests, terminal-background sensing, and terminal-output projection. One presenter binds capabilities, theme, and default width at the process boundary. Package render calls then carry their content props and any narrower per-call width. The package's interactive graph owns the bounded background query and environment-hint fallback; discern decides when to sense and which theme to select from the reading. Small narration lines use the presenter's semantic success, note, warning, failure, and lead forms while discern continues to own stream routing and group boundaries.

Value operations use `request*`, operation options use `*RequestOptions`, and shared lifecycle contracts use `Interaction*`; “prompt” remains available for coding-agent instructions. The product adapter in discern follows the same names and ships no compatibility aliases. Interaction frames derive their usable viewport from the current terminal height on every render; a caller's visible-count value is a ceiling, so short terminals reduce the list instead of painting beyond the viewport. A caller may also reserve rows above the request. The fitter subtracts that reservation before it measures the complete frame, which prevents a full-budget list from scrolling a composed header away. Search requests accept an initial stable choice ID. [`terminal_interaction.ts`](../../../src/lib/terminal_interaction.ts) maps the caller's product value through its existing stable-ID authority, rejects a value that names no choice, and sends only the resulting ID to the package. The docs browser retains its highlighted document within one browse loop. It does not persist state between command runs.

The same release makes the calm Heading the package default and gives it a configurable leading-line count. Top-level package headings normally keep their one-line default; a heading embedded in a discern-owned composition requests zero so the surrounding semantic group owns the boundary. Confirm keeps fixed frame geometry while its state changes, and selected choices use a distinct selected marker rather than highlight alone. Workflow steps direct their triangle by status: completed steps point upward and incomplete steps point downward.

Mixed Result summaries compose through the package's group renderer, which aligns fact columns across different state prefixes. Patterns and improvement therefore carry no local prefix-padding calculation. Command suggestions render as `Run: <command>` without a shell prefix, preserving the underlying command while keeping suggested future action visually distinct from previously typed shell input.

## Site-owned integration

[`site/design_system.ts`](../../../site/design_system.ts) contains the complete integration. Its `DESIGN_SYSTEM_BUNDLES` table declares:

| Bundle         | Routes                                    | Selection                                              | Optional assets |
| -------------- | ----------------------------------------- | ------------------------------------------------------ | --------------- |
| `docs`         | `/docs` and its descendants               | Docs, shared chrome, and the 6 rendered Workflow roots | fonts           |
| `compositions` | `/`, `/agents`, `/trust`, and `/releases` | Marketing, Editorial, and shared display parts         | fonts           |

The table also owns the emitted public directories. Beside it, [`SITE_APPEARANCE`](../../../site/appearance.ts) is the single browser Appearance authority: it selects the package's symmetric scope CSS and names the Accent roots and hue 255 that retain discern's blue identity. [`site/build.ts`](../../../site/build.ts) passes that scope selection and each bundle selection to the public `./runtime` emitter. The package resolves transitive component dependencies and writes deterministic CSS, selection-scoped browser scripts, a schema-4 manifest, and the requested assets. The production marketing and docs document builders put the shared root contract on `<html>`; nested fixed-theme specimen and art roots reuse its Accent activation and inherit the hue. The discern integration reads package outputs instead of copying the package manifest, tokens, dependency graph, CSS, behavior source, or adapters.

The docs shell loads its smaller bundle from `/assets/design-system/docs/`, including the emitted `discern.js` that promotes Glossary term's Hover card panels above clipping ancestors. The `/`, `/agents`, `/trust`, and `/releases` pages load the full selected bundle from `/assets/design-system/compositions/`. Each document in that bundle loads the package behavior script emitted for its selection. The release page uses the public semantic class contract at request time; the other marketing pages use build-time adapters. Both bundles select fonts; neither selects the optional grain asset. Generated output stays ignored beneath `site/pages/assets/design-system/`.

### Output coverage

[`scripts/site_component_coverage.ts`](../../../scripts/site_component_coverage.ts) reads the completed site build, renders every canonical HTML route, and compares each bundle's output with the package manifest. Its standard declares `jobs.build` as a prerequisite, including for standalone standard measurement. The raw `deno task site:component-coverage` task requires a completed `deno task site:build` and has no write or subprocess permission. Measurement therefore cannot remove generated modules while checks read them. A selected component is witnessed when a live route in that bundle renders one of its manifest-owned classes. Explicit component roots, selected groups, and transitive dependencies all enter the census from their existing registries.

[`[standards.site_component_gaps]`](../../../discern.toml) holds the raw number of selected components without output evidence as a falling ceiling. The deficit is held instead of a coverage percentage so adding components cannot dilute the measure. A package release that expands a selected Group can raise the raw deficit; changing the ceiling remains an owner decision on `main` until the new Component is planned. Rendering a selected component or narrowing a bundle that emits unused output closes a gap. The end state is zero: every component discern asks the package to emit has evidence in the routes that receive it.

[`tests/site_component_coverage_test.ts`](../../../tests/site_component_coverage_test.ts) separately requires every live route to render at least one component owned by its assigned bundle. The census does not score every Document Object Model (DOM) element: product copy, composition markup, and bespoke artwork remain site-owned. The consumer-style guard prevents those composition sheets from reaching into package-owned selectors.

The docs bundle selects the `Docs` group plus the shared `icon`, `icon-button`, `theme-toggle`, `brand`, `divider`, `heading`, `kicker`, `table`, `breadcrumbs`, and `table-of-contents` components. Its explicit Workflow roots are `procedure`, `command`, `result-summary`, `path-reference`, `ownership-badge`, and `branch-choice`; the package adds their dependencies in manifest order. A selected Workflow root must appear on a real manual journey, and a rendered root must resolve into this bundle.

Both bundles select the Core `Brand` component, which brings its `Logo` dependency with it. [`site/ui/components/Brand.tsx`](../../../site/ui/components/Brand.tsx) owns the canonical public lockup: the decorative `◮`, the visible `discern` name, the `mono` typeface, and an optional context tagline. The docs shell reuses its statically rendered markup. Both marketing compositions pass the same mark and name treatment into the Marketing `SiteHeader` campaign variant.

The homepage and release page select the monochrome Appearance; the other page families retain the explicit site Accent. Their [compositions](design-system-consumption.md) own product content and page layout. Shared component styling, assets, and behavior stay in the immutable package. The browser receives semantic HTML and local assets without a React runtime.

The static page boundary, marketing compositions, build commands, and manifest-driven consumer guards are recorded separately in [design-system-consumption.md](design-system-consumption.md).
