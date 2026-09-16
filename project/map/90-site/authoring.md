---
aliases:
  - edit a website page
  - React SSR
  - TSX layouts
  - website developer experience
---

# Authoring site pages

Start in [`site/ui/pages/`](../../../site/ui/pages/) for a React page and [`site/ui/layouts/`](../../../site/ui/layouts/) for its shared structure. [`Document.tsx`](../../../site/ui/Document.tsx) owns the document head, theme bootstrap, and assets. [`site/ui/components/`](../../../site/ui/components/) holds thin product adapters over the exact published design system. Page-specific styles and progressive enhancements live in `site/page-src/`; shared browser assets remain authored in `site/pages/assets/`.

HTML-producing site modules use `.tsx`; routing, registries, data models, and build orchestration use `.ts`. [`site/docs.tsx`](../../../site/docs.tsx) owns the manual, Map, and decision models, the Markdown body renderer with its Workflow and glossary projections, and the exported navigation facts (breadcrumb trails, pager adjacency, colophon destinations). It imports no React: the site route inventory evaluates it during codegen under permissions that exclude the `NODE_ENV` read `react-dom` performs on load. [`site/documents.tsx`](../../../site/documents.tsx) is where the React pages join that model: it negotiates each document request, serves raw editions and the search index, and renders the page components. The [docs contract](the-docs-section.md) governs that surface.

## Rendering and interaction

Marketing components render during `site:build`. Releases, the map overview, and every manual and decision page render on the server from their content models. Marketing-family pages use `Document` and `MarketingLayout`; document pages use `Document` and [`DocumentLayout`](../../../site/ui/layouts/DocumentLayout.tsx) ([ADR 0402](../_adr/0402-site-layouts-use-server-rendered-react-components.md)).

Server rendering produces the initial HTML. It does not run `useEffect` or attach React event handlers in the visitor's browser. The site currently uses the package's selected enhancements and page-owned JavaScript for interaction. Theme selection and Command's copy control both come from the package runtime; the site supplies only its theme storage policy and the pre-paint bootstrap.

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

## Shared layouts

[`MarketingLayout`](../../../site/ui/layouts/MarketingLayout.tsx) owns the public header, theme control, and footer. Pages supply their content and optional main-element class. [`site/navigation.ts`](../../../site/navigation.ts) owns the navigation destinations; page-specific reading aids belong inside the page body.

[`DocumentLayout`](../../../site/ui/layouts/DocumentLayout.tsx) owns the reading chrome: the package Docs header with the drawer control, lockup, search opener, and theme control; the rooted Docs nav with its reference foot links; one `main` landmark with package Breadcrumbs; the contents rail; and the statically rendered Search palette. Its `renderDocumentPage` selects the Docs bundle, `docs.css`, `docs.js`, and the pre-stylesheet enhancement class. Adapters under `site/ui/components/Document*.tsx` feed each package component from the model, and [`LeafList`](../../../site/ui/components/LeafList.tsx) renders every model-derived page run. Pages are [`ManualPage`](../../../site/ui/pages/ManualPage.tsx), [`ManualCoverPage`](../../../site/ui/pages/ManualCoverPage.tsx), [`DecisionPage`](../../../site/ui/pages/DecisionPage.tsx), and [`DecisionsIndexPage`](../../../site/ui/pages/DecisionsIndexPage.tsx). The three-column grid is site composition CSS; it is not a package layout.

## Component ownership

Use the package React adapter for a component. Site CSS owns composition and page classes; package classes and internal element structure stay upstream. [`site_ui_test.ts`](../../../tests/site_ui_test.ts) checks every authored site module for HTML-producing TypeScript and checks shared UI sources for package-class reconstruction and HTML-insertion boundaries.

A page that places package Markdown beneath its own heading passes the package's document context — a base heading level and an id prefix — instead of adjusting rendered output. [`HtmlFragment.tsx`](../../../site/ui/components/HtmlFragment.tsx) is the insertion boundary for trusted rendered markup and the authored theme bootstrap. Direct request text must never enter it. This module is the sole shared UI lint exclusion because it owns raw HTML insertion; the structural guard rejects that operation elsewhere in the shared UI. The other React modules and site build use the normal lint policy.
