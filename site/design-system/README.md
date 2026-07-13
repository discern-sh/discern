# Discern design system

Framework-neutral visual foundations with typed React adapters. This directory
owns reusable visual decisions; discern.sh page composition and product copy
live in `site/page-src/`.

## Commands

- `deno task build` — generate CSS, the component registry, manifest, and the
  browser styleguide bundle.
- `deno task check` — formatting, linting, and strict type checking.
- `deno task verify` — the complete local gate.
- `deno task serve` — optionally build and serve the styleguide alone at
  `http://127.0.0.1:8010/styleguide/`.

From the repository root, `deno task site:build` uses these adapters only at
build time to generate static public HTML and CSS. No React runtime ships with
the landing-page demo. Root `deno task watch` serves both that demo and the
local catalogue at `/styleguide/`, rebuilding them together when authored
design-system or page inputs change.

## Source rules

- Change design values in `src/tokens/tokens.ts`; generated CSS is never edited.
- Every public component owns a folder containing its implementation, styles,
  metadata, examples, and `mod.ts` export.
- Consumer styles may compose components through an added consumer class, but
  never target a component-owned `.ds-*` selector. Component internals remain
  reproducible from this directory alone.
- Component source contains no product copy and no remote asset URLs.
- Icons are renderable slots. `assets/fonts.css` is the optional, self-hosted
  provider for the font roles; consumers may replace it without changing the
  component runtime.
- New `*.meta.ts` + `*.examples.tsx` pairs are discovered by the build and
  automatically enter the styleguide.
- `assets/` owns reproducible fonts, licences, and textures. The build copies
  that complete tree into every runtime output.
- `dist/`, `styleguide/generated/`, and the public runtime under
  `site/pages/assets/design-system/` are ignored build output.

## Public surfaces

- `src/mod.ts` — React component exports and token types.
- `dist/discern.css` — tokens, foundations, utilities, and component styles.
- `assets/fonts.css` — optional local font faces matching the typography roles.
- Components can also be reproduced as semantic HTML using the documented
  `.ds-*` classes; React is an adapter rather than a CSS dependency.
