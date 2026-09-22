---
aliases:
  - design system integration
  - static rendering
  - site components
  - component consumption
---

# Design-system consumption

## React authoring and HTML responses

The site's React pages live in [`site/ui/`](../../../site/ui/). Marketing pages render at build time; Releases and the map directory render on the server. Their shared document and layout components use the package's typed React adapters. The browser receives HTML, CSS, and explicit progressive enhancements, with no hydration ([ADR 0402](../_adr/0402-site-layouts-use-server-rendered-react-components.md)). See [Authoring site pages](authoring.md) for editing locations and the server/browser distinction.

Layout and display components render completely as semantic HTML. The package emits selection-scoped, framework-neutral enhancements for reusable component behavior. Page behavior remains page-owned. Product copy, routes, commands, bespoke artwork, docs rendering, and composition Cascading Style Sheets (CSS) remain in discern.

## Workflow projections in the manual

The Markdown remains the complete manual for terminal, Model Context Protocol (MCP), negotiated text, `.md`, search, and browser readers. Some source blocks carry explicit `discern-workflow` HTML-comment markers around ordinary Markdown. [`site/workflow.tsx`](../../../site/workflow.tsx) parses those marked blocks and emits the package's semantic Procedure, Command, Result summary, Path reference, Ownership badge, and Branch choice anatomy for browser pages. It reads meaning only from the explicit markers.

[`site/workflow_registry.ts`](../../../site/workflow_registry.ts) is the canonical directive vocabulary and component selection. Each member must have a strict parser, a real source example, and a rendered root covered by the bundle tests. Malformed or unknown markers fail at the source path. The decision and rejected alternatives are recorded in [ADR 0205](../_adr/0205-browser-workflow-semantics-are-explicit-markdown-projections.md).

The marked Markdown is the authority for every command and outcome in the projection. When CSS or JavaScript is unavailable, the server HTML still states the complete procedure, result, ownership, and next action. Site-owned JavaScript adds the Command copy control in the package's documented slot. These corpus projections retain their source semantics independently of the React page renderer.

[`site/ui/components/Brand.tsx`](../../../site/ui/components/Brand.tsx) owns the reusable public lockup. The component uses the `md` preset and renders `discern` beside the decorative Unicode mark in the `mono` typeface. The document layout and the marketing compositions import the same adapter.

## The homepage composition

[`site/ui/pages/HomePage.tsx`](../../../site/ui/pages/HomePage.tsx) owns the homepage composition, route metadata boundary, and asset selection. It composes the package's marketing blocks in order. A statement Hero block sits over the monochrome Approach backdrop. It carries the launch introduction, a Get started link to `/docs/start`, and the agent Logo cloud in its visual slot. The benefit blocks follow in a compact Marketing section, then a Narrative chapter on the practice and a Feature bento of what the project gains. The hero eyebrow reads the version from [`src/lib/version.ts`](../../../src/lib/version.ts). The Logo cloud derives each agent's name, mark, and dark-theme silhouette from the provider registry, so a new provider appears without a copy change. The manual holds the detailed product information.

[`MarketingLayout.tsx`](../../../site/ui/layouts/MarketingLayout.tsx) owns shared landmarks and takes the route being rendered. The [site header](../../../site/ui/components/SiteHeader.tsx) and [site footer](../../../site/ui/components/SiteFooter.tsx) use the package adapters, and the header renders the package Theme toggle directly. Pages supply navigation, actions, footer destinations, and body content. [`CopyPrompt.tsx`](../../../site/ui/components/CopyPrompt.tsx) owns the commissioning text and uses the package Button; `site/page-src/copy-prompt.js` supplies its clipboard enhancement.

[`site/navigation.ts`](../../../site/navigation.ts) owns route matching for the header: a destination equal to the route is the current page, and a destination whose branch contains it is the current section. The package renders both states from `aria-current` and styles them; the site never restates the anchor markup.

The marketing blocks, header, and footer share the package's wide campaign frame through their `frame` option. The Logo cloud fills the hero's visual slot. The large bento tile aligns its copy to the tile's end. The footer asks for one row per navigation group. [`site/page-src/landing.css`](../../../site/page-src/landing.css) styles only the page's own composition classes: the eyebrow, introduction, benefit row, and chapter subheading. It reaches into no package block. A layout the package cannot express needs a package option first. Component behavior and artwork come from the selected design-system runtime. The homepage has no page-specific browser script. [`site/brand.ts`](../../../site/brand.ts) owns the homepage's title and description.

## The For Agents composition

[`site/ui/pages/AgentsPage.tsx`](../../../site/ui/pages/AgentsPage.tsx) contains the agent-native composition registered at `/agents` and currently unpublished: it keeps its prose checks and word-ceiling standard while the site neither builds nor serves it. It moves from context economy and callable operations through session continuity, isolated work, human authority, provider continuity, deterministic boundaries, and exact machine routes. Its provider compiler derives labels, instruction files, and marks from the same total agent and provider registries as the integrations themselves. The route therefore gains a newly supported provider without a copied marketing list. `/llms.txt` is the machine-readable handoff; the campaign has no overlapping Markdown companion.

[`site/page-src/agents.css`](../../../site/page-src/agents.css) owns its `.agents-*` composition selectors. The page composes static package components through their typed slots and published CSS variables; consumer selectors never reach into package-owned classes. It uses the shared public navigation and system-aware theme control. [`site/renderers.ts`](../../../site/renderers.ts) exhaustively maps each `MARKETING_PAGES` route to its static renderer, so adding a registry member without a composition fails type checking.

## The release composition

The [human release page](releases.md#the-human-page) is rendered at request time from the shared comparison model. It uses the same package through its public semantic HTML contract, preserving a framework-free handler and browser. The version card and installer command use package components; the reading rail and responsive rhythm belong to the release stylesheet. All comparison states and complete notes work without scripts.

## Public-site prose

[`site/marketing_pages.ts`](../../../site/marketing_pages.ts) enrolls every marketing composition in public prose checks, and its published members in building, serving, route discovery, and runtime checks. Each member names its output, authored source, register, negotiation policy, prose policy, and publication state. A guarded page joins [`scripts/site_prose_lib.ts`](../../../scripts/site_prose_lib.ts), the site scope, and the site prose standards through that registration. The homepage uses the brand register; `/agents` uses the public agent register.

The projection keeps the authored blocks a visitor reads and removes markup, attributes, code, artefact data, and repeated rendered copies. It stages each page under its declared register so the generated brand rules apply. `deno task site:prose-check` blocks Vale errors. `deno task site:prose` emits the alert numerator and exact word denominator consumed by `[standards.site_prose]`; `deno task site:reading-grade` reads the same projection for `[standards.site_reading_grade]`.

The generic component catalog, examples, component implementation, assets, and package tooling live only in the package repository. The discern site does not mount `/style-guide/` in development or production.

## Development-only artefact specimens

[`site/ui/pages/SpecimensPage.tsx`](../../../site/ui/pages/SpecimensPage.tsx) composes the complete delegation, commissioning, Standard, and Proof artefacts from the published design-system primitives. [`site/page-src/specimens.css`](../../../site/page-src/specimens.css) owns their editorial layout without targeting package-owned `.discern-*` selectors. Each artefact renders inside fixed light and dark token roots, side by side where space permits, so the owner can review both themes in the same document. This sheet is the retained source for full artefacts removed or simplified on the homepage.

[`site/specimens.ts`](../../../site/specimens.ts) builds the normal static design-system assets and serves the specimen document plus its composition CSS directly from source on the worktree's local port:

```sh
deno task site:specimens
```

The command prints the preview address. The sheet is static HTML and CSS with the shared theme controller as its only external browser script. It is absent from `PAGES`, returns `404` through the production handler, and carries `noindex` response headers. [`tests/site_specimens_test.ts`](../../../tests/site_specimens_test.ts) guards that development boundary, the paired themes, the evidence text, unique document identifiers, absence of a browser framework runtime, and the rule that monospace appears only on the product name and code.

The same local development server exposes the internal art archive at `/art/`; `deno task site:art` is the memorable alias for starting it. [`BROWSER_ARTWORKS`](../../../art/browser/registry.ts) owns the approved browser studies, their order, labels, recorded source commits, and stylesheet enrollment; a member still under review carries an all-zero placeholder until its source head is pinned. Its neighboring typed renderer table is exhaustive over that membership. [`site/ui/pages/ArtGalleryPage.tsx`](../../../site/ui/pages/ArtGalleryPage.tsx) derives the paired light/dark gallery and projects the terminal registries from [`art/terminal/`](../../../art/terminal/) into static terminal mockups below it. Geometry and motion remain artwork-owned rather than passing through a common animation framework.

Every browser study keeps its TypeScript JSX (TSX) renderer and art-only CSS together under [`art/browser/`](../../../art/browser/). The page chrome remains in [`site/page-src/art-gallery.css`](../../../site/page-src/art-gallery.css). The figure-series studies named by the registry's `FIGURE_SERIES_SLUGS` export also share one foundation stylesheet, [`art/browser/figures.css`](../../../art/browser/figures.css), holding the series' beat, easing curves, stroke scale, opacity steps, palette bindings, and reduced-motion switch. [`tests/art_browser_gallery_test.ts`](../../../tests/art_browser_gallery_test.ts) guards `/art/` as development-only, derives stylesheet coverage from the registry, proves prospective-member enrollment, and rejects browser framework runtime. Each study's `browser_art_*_test.ts` file retains its own geometry and motion contracts, and [`tests/browser_art_figures_test.ts`](../../../tests/browser_art_figures_test.ts) holds every enrolled figure to the shared metre: token-only color, one phrase clock on a whole beat multiple, motion loops that close where they open, and a bounded animated-property set.

## Consumer guards

[`tests/site_design_system_runtime_test.ts`](../../../tests/site_design_system_runtime_test.ts) reads the public `packageManifest` and the site selection table. It guards:

- the exact config and lockfile coordinate, public imports, and absence of internal or registry-path reach-through;
- each bundle's requested selection and package-resolved dependency closure;
- every package browser script emitted for a selection being loaded by every route that uses that bundle;
- runtime-manifest schema 4 and Appearance-scope selection;
- exclusion of Marketing and Editorial CSS and grain from the docs bundle;
- route-to-bundle coverage, local assets, media types, integrity, font licenses, and the absence of a React browser runtime; and
- the rule that consumer styles may compose package classes while leaving component-owned `.discern-*` selectors untouched.

The published manifest automatically enrolls new package components and classes. `DESIGN_SYSTEM_BUNDLES` automatically enrolls new site selections and routes.

[`scripts/site_component_coverage.ts`](../../../scripts/site_component_coverage.ts) uses the same authorities to census selected components that have no manifest-owned class in any assigned live route. `[standards.site_component_gaps]` prevents that raw deficit from rising while the site converges on complete use of what it emits. [`tests/site_component_coverage_test.ts`](../../../tests/site_component_coverage_test.ts) keeps every live HTML route inside a selected component boundary.

[`tests/site_workflow_test.ts`](../../../tests/site_workflow_test.ts) ties the directive registry to its source examples, package roots, dependency closure, and pristine raw editions. The canonical-set atlas enrolls the directive set, so a new projection inherits those obligations.

## Build and theme

```sh
deno task site:build   # emit both runtimes and the static marketing shells
deno task site         # build, then serve on the worktree's loopback port
deno task watch        # rebuild when site-owned inputs change
deno task site:prose-check # run the public-copy Vale gate
deno task site:prose   # measure the pinned public-copy density
deno task site:reading-grade # measure the pinned reading grade
```

The build and local server tasks explicitly grant `NODE_ENV` for React rendering. The production import graph permits server React and rejects its browser entrypoint. Response tests separately reject browser React assets. This keeps server-side rendering and client hydration as distinct choices.

The package's browser roles default to monochrome. [`SITE_APPEARANCE`](../../../site/appearance.ts) emits the symmetric Appearance scopes. Its root helper uses blue hue 255 by default; a page can select the monochrome projection through [`site/ui/Document.tsx`](../../../site/ui/Document.tsx). The homepage and release page select monochrome with `data-discern-accent="none"`. The other marketing pages, docs, and the Canon Editor retain the shared blue Accent, while fixed-theme specimen and art roots inherit that hue. Browser Appearance remains separate from terminal theme selection.

The display role prefers Iowan Old Style where the visitor has it, then uses bundled Crimson Pro as its first portable fallback. Inter serves body and interface roles, and JetBrains Mono serves code. The build copies the bundled fonts and SIL Open Font License texts from the selected package asset pack into local generated output. `site/theme.ts` gives every static composition and document page one pre-paint bootstrap.

[`site/theme.ts`](../../../site/theme.ts) owns the theme policy the package behavior reads. Every shell's root carries `data-discern-theme="system"` and names the storage key, so a reader with no stored choice follows their device through the emitted `prefers-color-scheme` rules with or without JavaScript. The pre-paint bootstrap applies a stored `light` or `dark` and nothing else. From there the package's selected `theme-toggle` behavior owns the control: it resolves the theme, swaps the destination label and glyph, writes the named storage key, and heals a root left out of step. A control names its destination rather than carrying a pressed state, and stays inert until that behavior activates it. The React layouts render the control directly; the Canon Editor's server, which composes HTML as strings, renders the same control through [`renderThemeToggleHtml`](../../../site/ui/components/ThemeToggle.tsx) rather than restating its markup.
