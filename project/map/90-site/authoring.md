---
aliases:
  - edit a website page
  - React SSR
  - TSX layouts
  - website developer experience
---

# Authoring site pages

Start in [`site/ui/pages/`](../../../site/ui/pages/) for a React page and [`site/ui/layouts/`](../../../site/ui/layouts/) for its shared structure. [`Document.tsx`](../../../site/ui/Document.tsx) owns the document head, theme bootstrap, and assets. [`site/ui/components/`](../../../site/ui/components/) holds thin product adapters over the exact published design system. Page-specific styles and progressive enhancements live in `site/page-src/`; shared browser assets such as `theme.js` remain authored in `site/pages/assets/`.

HTML-producing site modules use `.tsx`; routing, registries, data models, and build orchestration use `.ts`. The document corpus renderer is [`site/docs.tsx`](../../../site/docs.tsx). It preserves the manual, Map, and decision models while its shell and workflow projections remain separate from the React page layouts. The [docs contract](the-docs-section.md) governs a component conversion of that surface.

## Rendering and interaction

Marketing components render during `site:build`. Releases and the map overview render on the server from their content models. These pages use `Document` and `MarketingLayout` ([ADR 0402](../_adr/0402-site-layouts-use-server-rendered-react-components.md)).

Server rendering produces the initial HTML. It does not run `useEffect` or attach React event handlers in the visitor's browser. The site currently uses the package's selected enhancements and page-owned JavaScript for interaction. For example, the theme adapter supplies package markup while `theme.js` owns preference and events; Command's copy control uses the package runtime.

Hydration would load a browser React entrypoint and connect React to matching server-rendered markup. That enables effects and stateful components, while adding JavaScript, initial-state consistency, and browser build obligations. A component needing hydration must have that integration explicitly; a server-rendering import alone cannot provide it.

## Local editing

Run this Project Script from the effort's worktree:

```sh
discern scripts site-watch
```

It prints the localhost address, builds the site, and watches authored inputs. Reload the browser after a rebuild. This is a source watcher, not React Fast Refresh. Treat generated page HTML under `site/pages/` as output and edit its TSX source; shared authored assets in `site/pages/assets/` remain editable.

## Add a public route

Use [`MARKETING_PAGES`](../../../site/marketing_pages.ts) for a static composition and its exhaustive renderer table in [`site/renderers.ts`](../../../site/renderers.ts). Fixed non-document endpoints belong in [`SITE_ENDPOINTS`](../../../site/routes.ts), whose handler choices are exhaustive. Document URLs derive from their admitted source models.

[`siteRoutes`](../../../site/routes.ts) combines these authorities into HTML pages, raw editions, fixed responses, and the asset namespace. The sitemap selects HTML routes; the `project/map/_internal/registry-atlas.md` derives the complete inventory. The [route tests](../../../tests/site_routes_test.ts) exercise new members, duplicate rejection, and the actual endpoint responses.

## Shared site navigation

[`MarketingLayout`](../../../site/ui/layouts/MarketingLayout.tsx) owns the public header, theme control, and footer. Pages supply their content and optional main-element class. [`site/navigation.ts`](../../../site/navigation.ts) owns the navigation destinations; page-specific reading aids belong inside the page body. The manual keeps its document navigation until its shell moves to components.

## Component ownership

Use the package React adapter for a component. Site CSS owns composition and page classes; package classes and internal element structure stay upstream. [`site_ui_test.ts`](../../../tests/site_ui_test.ts) checks every authored site module for HTML-producing TypeScript and checks shared UI sources for package-class reconstruction and HTML-insertion boundaries.

[`Markdown.tsx`](../../../site/ui/components/Markdown.tsx) delegates parsing and rendering to the package, then scopes note anchors and heading depth. Heading depth and anchor scope provide document context without forking component markup. [`HtmlFragment.tsx`](../../../site/ui/components/HtmlFragment.tsx) is the insertion boundary for that trusted result and the authored theme bootstrap. Direct request text must never enter it.
