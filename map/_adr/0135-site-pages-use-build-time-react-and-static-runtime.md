# ADR 0135: Site pages use build-time React and a static runtime

**Status**: accepted

## Context

The first discern.sh editions were self-contained HTML experiments. They proved
several messages and visual directions quickly, but each page owned a separate
Tailwind theme, component vocabulary, font request, and inline script. Growing
that pattern into the permanent site would make every shared visual decision a
manual multi-page migration.

A prototype design system supplied typed tokens, framework-neutral CSS, React
adapters, component metadata, and an automatically discovered local catalogue.
Adopting it raised a separate question: whether the public site should become a
client-side React application. The existing site has no application runtime or
build requirement in production; its Deno fetch handler serves static files and
negotiates text editions directly.

## Decision

The authored design system lives at `site/design-system/`. It owns only neutral
visual foundations and components. Product-specific page composition lives at
`site/page-src/`.

Pages use the typed React adapters at build time. `site/build.ts` renders page
sources to static HTML, builds deterministic framework-neutral CSS and assets,
and writes the committed artifacts under `site/pages/`. Deno Deploy continues to
run the existing fetch handler without a client framework, hydration, or a
deployment build step.

The React component catalogue remains a local development surface. Stateful
React behaviour is not assumed to survive static rendering: public pages use
static-safe components and page-owned progressive enhancement unless a later
decision explicitly introduces a browser runtime.

The first consumer is `/design-system-demo`. The four existing experimental
pages remain unchanged until a replacement edition is ready to be compared and
switched over as one page-sized change.

## Consequences

- Page authors get typed composition and one component markup source without
  sending React to visitors.
- The production handler and its local-equals-production property remain
  unchanged; generated artifacts are committed and guarded for currency.
- Component source stays reusable because it carries no discern.sh copy, remote
  asset provider, or route knowledge.
- The public demo self-hosts fonts and textures. It can honestly claim zero
  third-party runtime requests even while the older experiments still await
  their migration.
- Interactive catalogue components need an explicit browser implementation on a
  public page. Static rendering is not treated as implicit hydration.
- Each existing edition can migrate independently, preserving a complete old
  artifact for comparison and rollback until its route changes.
