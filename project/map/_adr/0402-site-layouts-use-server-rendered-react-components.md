# ADR 0402: Site layouts use server-rendered React components

> **Amendment (2026-09-16) — the document corpora converted.** Manual and decision pages render through `DocumentLayout` and page components under `site/ui/`. The corpus model and body renderer in `site/docs.tsx` stay React-free: the site route inventory evaluates that module during codegen, whose permissions exclude the `NODE_ENV` read `react-dom` performs on load. `site/documents.tsx` is the request handler where React joins the model. Package components the static, progressive-enhancement site cannot consume as-is — the hydrated Search palette and the self-numbering Table of contents — are consumed up to their boundary and the gap is named there, not recreated locally.

**Status**: accepted on 2026-09-15. Amends [ADR 0135](0135-site-pages-use-build-time-react-and-static-runtime.md), [ADR 0139](0139-the-design-system-is-an-independent-package.md), [ADR 0205](0205-browser-workflow-semantics-are-explicit-markdown-projections.md), [ADR 0279](0279-external-terminal-rendering-crosses-one-process-boundary.md), and [ADR 0287](0287-terminal-markdown-delegates-to-the-design-system.md).

## Context

The site's owner works fluently in React. Build-time marketing pages, string-based document shells, and a separate release renderer make the same layout change require different techniques. Repeating package component anatomy in strings also prevents an upstream component fix from reaching the consumer through a dependency update.

The production server's React exclusion forces this split even though the site already depends on React for authoring. Release comparisons depend on a request's version parameter. A pre-rendered page cannot express every comparison without another rendering mechanism or browser computation.

## Decision

HTML-producing site modules use `.tsx`. React pages, shared layouts, and site adapters live under `site/ui/`; routing, content models, text projections, and build orchestration remain TypeScript. The shared `Document` renders complete HTML for both build-time marketing output and request-time release comparisons. `MarketingLayout` owns their shared header, footer, and landmarks; the navigation destinations are centralized in `site/navigation.ts`. Page components consume the exact published design-system React adapters; they do not reconstruct package classes or component anatomy.

React is allowed in the website server. Browser hydration is a separate decision: the current output uses HTML, CSS, package enhancements, and page-owned JavaScript. React effects and event handlers do not execute in that output. The terminal engine's dependency and process boundaries remain independent.

Markdown stays the content authority. Release notes use the package Markdown component, with one site adapter adjusting heading depth and anchor scope until those controls are available upstream. Its serialized output and the authored theme bootstrap pass through one explicit HTML-insertion component. The document corpora retain their own TSX shell and workflow/glossary projections; their component conversion must preserve raw editions, source semantics, navigation, and search.

The route inventory derives from the marketing registry, document models, and fixed endpoint registry. Serving, the sitemap, and the generated atlas consume that inventory. Publishing a document does not require adding its URL to a second list.

## Consequences

- Page authors navigate by component and layout, and package markup updates reach consumers through the published adapters.
- React adds dependencies and rendering work to the website server. Request validation and caching remain server responsibilities; the installed CLI gains no React requirement from this decision.
- A page using `useEffect`, React state transitions, or React event handlers needs an explicit browser entrypoint and hydration. Merely adding those hooks to a server component does not activate them.
- Structural tests enroll future site sources in the TSX convention and reject package-class reconstruction in the shared UI. Existing corpus renderers retain their document contracts while they move to components.
- The existing exact package pin, local asset emission, content negotiation, and browser accessibility obligations remain in force.

## Alternatives considered

Keeping React build-only would require pre-rendering documents and retaining a separate solution for query-dependent releases. A complete client application framework could add hydration and Fast Refresh, but it would couple the authoring cleanup to a browser-runtime decision for which no current page requires React.
