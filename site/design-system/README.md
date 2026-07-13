# Discern design system

Framework-neutral visual foundations with typed React adapters. This directory
owns reusable visual decisions; discern.sh page composition and product copy
live in `site/page-src/`.

## Commands

- `deno task build` — generate CSS, the component registry, manifest, and the
  browser styleguide bundle.
- `deno task check` — formatting, linting, and strict type checking.
- `deno task verify` — the complete local gate.
- `deno task serve` — build and serve the local styleguide at
  `http://127.0.0.1:8010/styleguide/`.

From the repository root, `deno task site:build` uses these adapters only at
build time to generate static public HTML and CSS. No React runtime ships with
the landing-page demo. `deno task watch` serves that demo on localhost and
rebuilds it when authored design-system or page inputs change.

## Source rules

- Change design values in `src/tokens/tokens.ts`; generated CSS is never edited.
- Every public component owns a folder containing its implementation, styles,
  metadata, examples, and `mod.ts` export.
- Component source contains no product copy and no remote asset URLs.
- Icons are renderable slots. Font loading belongs to the consuming app or the
  isolated styleguide font provider.
- New `*.meta.ts` + `*.examples.tsx` pairs are discovered by the build and
  automatically enter the styleguide.
- `dist/`, `styleguide/generated/`, and the public runtime under
  `site/pages/assets/design-system/` are ignored build output. Authored public
  assets live under `site/page-src/assets/design-system/`.

## Public surfaces

- `src/mod.ts` — React component exports and token types.
- `dist/discern.css` — tokens, foundations, utilities, and component styles.
- Components can also be reproduced as semantic HTML using the documented
  `.ds-*` classes; React is an adapter rather than a CSS dependency.
