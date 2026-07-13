# The site design system

The design system is the long-term visual foundation for discern.sh. It can
evolve beside the original self-contained HTML experiments, and a page adopts it
only when its own generated edition is ready to replace the old route.

## Ownership boundaries

| Tree                                               | Owns                                                                                                                   |
| -------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------- |
| [`site/design-system/`](../../site/design-system/) | Product-neutral tokens, foundations, utilities, components, metadata, examples, assets, and the local React catalogue. |
| [`site/page-src/`](../../site/page-src/)           | Page composition, product copy, and small progressive enhancements.                                                    |
| [`site/pages/`](../../site/pages/)                 | Hand-authored legacy editions plus ignored design-system output created before local serving or deployment.            |

Product copy never enters the component library. Conversely, page sources use
the library's tokens and components rather than reproducing their markup or
visual values. That boundary keeps a reusable system on one side and a specific
site on the other.

## Static production, typed authoring

Page authors compose typed React adapters.
[`site/build.ts`](../../site/build.ts) renders them with `renderToStaticMarkup`,
builds the framework-neutral CSS, and writes deterministic HTML and assets into
`site/pages/`. The output is ignored and rebuilt both locally and by Deno
Deploy. React is a build-time dependency: the browser receives no React bundle,
hydration, or application runtime.

The distinction matters for interactive components. Layout and display
components render completely as static HTML. React adapters that own state or
event behaviour — tabs, dialog boxes, toasts — belong in the local catalogue but
do not become interactive merely by static rendering. A public page either uses
a native browser primitive or adds a small, page-owned progressive enhancement;
shipping a client framework is a separate architecture decision.

## Build and catalogue

```sh
deno task site:build             # static public demo + runtime CSS
deno task design-system:build    # local component catalogue bundle
deno task design-system:verify   # subsystem check, build, and tests
deno task site                   # build, then serve on main/worktree port
deno task watch                  # serve and rebuild when authored inputs change
```

The root watch task also builds and serves the catalogue at `/styleguide/` on
the same main/worktree port as the public demo. The subsystem's
`deno task
serve` remains available for an isolated catalogue-only process, but
ordinary design iteration needs only the root watcher.

The library build discovers every `*.meta.ts` file. Its component folder must
also carry the implementation, CSS, examples, and `mod.ts`; the public module
must export that folder. This is checked from the discovered set, so a new
component auto-enrols rather than waiting for a hand-maintained test list.

The design-system README is the standalone page-authoring handoff: it identifies
the public entrypoints, root/theme contract, layout primitives, typography
roles, and the implementation/metadata/example source for each component.
Consumer styles may compose a component through their own class but may not
target classes declared by component CSS. The subsystem guard derives the owned
class set from every component stylesheet and scans all authored site CSS, so
new components, shared primitives, and consumer styles auto-enrol.

`site/design-system/` is a Deno workspace member. The repository-wide
`deno check` therefore includes it with its JSX and React dependency contract,
while its scoped gate owns the catalogue build and subsystem tests.

The generated runtime consists of `discern.css`, a deterministic manifest, and
the complete authored `site/design-system/assets/` tree. That tree includes the
optional local `fonts.css` provider, its WOFF2 files and SIL Open Font Licence
texts, and texture assets. The isolated catalogue and generated demo therefore
use the same design-system-owned provider; a consumer may replace it without
changing the component runtime.

## Theme fidelity

The numbered accent ramp names roles, not fixed lightness. In light mode,
`accent-100` is the palest tint and `accent-800` is the deepest text; dark mode
remaps the same roles so `accent-100` remains the quietest background and
`accent-800` remains the strongest text. Components never compensate for a
light-only palette locally. The subsystem test discovers every numbered colour
ramp and rejects fixed members or a dark ramp whose roles do not invert.

The grain wash is the one textured colour flourish. Its shared utility owns the
gradient geometry, overlay blend, grain scale, and opacity, and pages use it at
most once, normally for the hero. Alternating content bands use the semantic
canvas, raised surface, and sunken surface roles rather than inventing
page-local greys.

## The experiment route

`/design-system-demo` is a non-negotiated HTML route and the first consumer. It
exercises page composition, responsive layout, light and dark themes, local
assets, and small copy/theme enhancements without touching `/`, `/agents`,
`/start`, or `/careers`. The `/docs` shell is the second consumer, reproducing
components as semantic HTML on the server — see
[the-docs-section.md](the-docs-section.md).

The migration pattern is deliberately page-sized:

1. compose a new page under `site/page-src/`;
2. generate it beside the existing edition without changing the live route;
3. compare desktop, mobile, themes, assets, and reader behaviour;
4. switch the route only after the new edition has passed its proof;
5. remove the superseded HTML in a later deliberate cleanup.

The original page remains a rollback surface throughout the comparison rather
than being partially converted in place.
