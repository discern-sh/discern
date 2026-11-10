---
aliases:
  - homepage wall
  - benefit wall
  - wall island
  - React hydration
  - tuning panel
  - wall glyphs
---

# The homepage wall

The homepage body is one wall of small cards between the shared site header and footer. Each card states one thing discern does. A visitor scans the cards in any order, narrows them with a lens, and opens a card for a second paragraph and a link into the manual.

The wall is the site's only hydrated React island ([ADR 0430](../_adr/0430-the-homepage-ships-one-hydrated-react-island.md)). The server renders the complete page, and the browser then hydrates the wall so its controls respond. No other route sends a framework runtime to the browser.

## Where each concern lives

Components, hooks, and data live in [`site/wall/`](../../../site/wall/). Stylesheets live in `site/page-src/`.

| Concern                                    | Source                                                                                                                                                                                             | Guard                                                                                                                                                            |
| ------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Document shell and island host             | [`HomePage.tsx`](../../../site/ui/pages/HomePage.tsx)                                                                                                                                              | [`site_wall_island_test.ts`](../../../tests/site_wall_island_test.ts)                                                                                            |
| Page body and root state                   | [`WallPage.tsx`](../../../site/wall/WallPage.tsx)                                                                                                                                                  | [`site_homepage_browser_test.ts`](../../../tests/site_homepage_browser_test.ts)                                                                                  |
| Seam between server render and island      | [`host.ts`](../../../site/wall/host.ts), [`island.tsx`](../../../site/wall/island.tsx)                                                                                                             | [`site_wall_island_test.ts`](../../../tests/site_wall_island_test.ts)                                                                                            |
| Built assets and the island's file name    | [`assets.ts`](../../../site/wall/assets.ts), [`site/build.ts`](../../../site/build.ts)                                                                                                             | [`site_wall_island_test.ts`](../../../tests/site_wall_island_test.ts), [`site_design_system_runtime_test.ts`](../../../tests/site_design_system_runtime_test.ts) |
| Data contract, cards, lenses, cluster hues | [`types.ts`](../../../site/wall/types.ts), [`deck.ts`](../../../site/wall/deck.ts), [`clusters.ts`](../../../site/wall/clusters.ts)                                                                | [`site_wall_deck_test.ts`](../../../tests/site_wall_deck_test.ts)                                                                                                |
| A card, the lens, and the opened card      | [`Card.tsx`](../../../site/wall/Card.tsx), [`Lens.tsx`](../../../site/wall/Lens.tsx), [`OpenCard.tsx`](../../../site/wall/OpenCard.tsx), [`use_open_card.ts`](../../../site/wall/use_open_card.ts) | [`site_homepage_browser_test.ts`](../../../tests/site_homepage_browser_test.ts)                                                                                  |
| Glyph vocabulary, drawings, and renderer   | [`glyph_grammar.ts`](../../../site/wall/glyph_grammar.ts), [`glyphs.ts`](../../../site/wall/glyphs.ts), [`Glyph.tsx`](../../../site/wall/Glyph.tsx)                                                | [`site_wall_glyph_test.ts`](../../../tests/site_wall_glyph_test.ts)                                                                                              |
| Pointer light and the stage                | [`use_light.ts`](../../../site/wall/use_light.ts), [`use_stage.ts`](../../../site/wall/use_stage.ts)                                                                                               | [`site_homepage_browser_test.ts`](../../../tests/site_homepage_browser_test.ts)                                                                                  |
| Tunable values and the tuning panel        | [`tuning/knobs.ts`](../../../site/wall/tuning/knobs.ts), [`tuning/Panel.tsx`](../../../site/wall/tuning/Panel.tsx)                                                                                 | [`site_wall_island_test.ts`](../../../tests/site_wall_island_test.ts), [`site_homepage_browser_test.ts`](../../../tests/site_homepage_browser_test.ts)           |

`WALL_STYLESHEETS` in `assets.ts` lists the wall's stylesheets in cascade order, and the build copies each one beside the homepage's design-system bundle:

| Stylesheet                                                              | Styles                                                          |
| ----------------------------------------------------------------------- | --------------------------------------------------------------- |
| [`wall.css`](../../../site/page-src/wall.css)                           | Page layout, the headline pool, the stage, and the wall plane.  |
| [`wall-card.css`](../../../site/page-src/wall-card.css)                 | Card surfaces and their rest, hover, focus, and pressed states. |
| [`wall-glyph.css`](../../../site/page-src/wall-glyph.css)               | Glyph tones, stroke, and the hover move.                        |
| [`wall-interactions.css`](../../../site/page-src/wall-interactions.css) | Lens chips, receded cards, and the opened card.                 |
| [`wall-tuning.css`](../../../site/page-src/wall-tuning.css)             | The tuning panel.                                               |

Each kind of movement has one element. Hover transforms belong to `.wall-card-face`. The scroll approach transforms `.wall-plane`. The list item `.wall-card` changes only opacity and filter. Keeping them apart stops a transform in one stylesheet from replacing a transform in another.

## Server render and hydration

[`renderLanding`](../../../site/ui/pages/HomePage.tsx) renders `WallPage` to markup inside the host element `#wall-island` and writes the props it used to that element's `data-wall-props` attribute. The island reads them back through `decodeWallProps`, which refuses a malformed value, and hydrates the host with the same component. The props are plain text: the mark, the version, the headline, and the category line. The deck, lenses, and knob table are modules the component imports on both sides.

Hydration has nothing to reconcile only while both renders produce the same markup. These rules keep them equal:

- `WallPage` and everything under it read no clock, no randomness, and nothing from the browser before an effect runs.
- No component calls `useId`. An element id is a fixed string or derives from a card id.
- The site build formats every generated page, and reformatting the wall's markup would change the nodes React expects. `HomePage.tsx` places a formatter directive before the host so the formatter leaves that element alone.

The island test proves the result: the served homepage contains the bytes that `renderToString` produces from the props on the host.

The page works before script runs. Every card's text, the headline, and the call to action are server markup. Controls that need script stay hidden until the island sets `data-wall-live`, so a reader without script sees no dead control. The opened card and the tuning panel never appear in server markup. `OpenCard` renders nothing until a card is open, and the wall checks the address for the panel's parameter only after it mounts.

The wall root `.wall` carries the page's state for the stylesheets. Every knob is an inline `--wall-<name>` custom property. Script adds data attributes as the state changes: `data-wall-live` once the island has hydrated, `data-wall-lens` while a lens is active, and the stage's marks, `data-wall-stage` and `data-wall-near`. The doc comments on [`WallPage`](../../../site/wall/WallPage.tsx) and in [`use_stage.ts`](../../../site/wall/use_stage.ts) list every attribute and its meaning. Script sets them all, so nothing a reader needs may depend on one.

## The build step

[`buildSite`](../../../site/build.ts) bundles the island before it renders any page, because the homepage links the bundle by a name only the build knows. [`bundleBrowserModule`](../../../site/page-src/format-generated.ts) runs `deno bundle --platform browser --minify` on `island.tsx`. It resolves React through the repository's import map and lockfile. The bundle step and the generated-page formatter share one [registered spawn boundary](../50-engine-internals/subprocess-boundaries.md).

The build writes the bundle as `wall-island.<hash>.js` beside the wall's stylesheets. The hash is the leading hexadecimal digits of the SHA-256 digest of the file's own bytes, so a page cannot pair with a bundle built from other markup. `wallIslandFileName` and `wallIslandContentHash` in `assets.ts` own that naming for the build and for the tests.

[`renderMarketingPage`](../../../site/renderers.ts) takes the generated file names as an optional argument. The build passes the island's name. Every other caller, such as the prose checks, omits it and receives the same document without the script. The build fails unless the island's name appears in the homepage and in no other page.

[`SITE_BUILD_INPUTS`](../../../site/build_inputs.ts) includes `site/wall`, so the watcher rebuilds after a wall edit. Deno labels `deno bundle` experimental. The island test compares the built file with a fresh bundle of its entry, so a stale build or changed `deno bundle` output fails there.

## The deck

[`deck.ts`](../../../site/wall/deck.ts) authors the cards by cluster, in the benefit canon's order, so the copy for one family of outcomes reads together. `WALL_DECK` is the same set in display order. A golden-ratio sequence scatters each cluster through the wall and spaces the statement and numeral cards among the benefit cards. The order depends only on each card's position in the authored list, so the server and the browser agree.

[`types.ts`](../../../site/wall/types.ts) defines the card kinds. A benefit shows a glyph, a title, and one line. A statement shows one short sentence. A numeral shows a number, a title, and one line. Every card names its `source` and the entry it `cites`:

| Source          | Registry                                                                                                         |
| --------------- | ---------------------------------------------------------------------------------------------------------------- |
| `human-benefit` | The human benefit canon in [`scripts/feature_registry.ts`](../../../scripts/feature_registry.ts)                 |
| `agent-benefit` | The agent benefit canon in the same module                                                                       |
| `consequence`   | Consequences written for the person in [`scripts/brand/consequences.ts`](../../../scripts/brand/consequences.ts) |
| `claim`         | The claims ledger in [`scripts/brand/claims.ts`](../../../scripts/brand/claims.ts)                               |

A human-benefit card takes the benefit's registry id as its own id. `WALL_ABSENT` names any human benefit the wall omits and gives the reason. The deck test fails when a human benefit is neither a card nor listed there.

A numeral card states a count as fact, so the count comes from its inventory. The agent names come from [`agent_catalogue.ts`](../../../src/shared/agent_catalogue.ts) when the page renders. The count of discern's own quality limits is a constant, because `deck.ts` also runs in the browser, where it cannot read `discern.toml`. The deck test holds that constant equal to the file. On the published site, `src/` comes from the released product ([Publish a website update](publishing.md#publish-a-website-update)), so the wall names the agents that release supports and shows its version.

`WALL_LENSES` gives each lens a label and the clusters it shows. A lens recedes the cards outside its clusters and removes none. `clusters.ts` gives each cluster one hue, which a card passes to the stylesheets as `--wall-hue`.

Card fronts are server markup, so the [public-site prose checks](design-system-consumption.md#public-site-prose) and the reading-grade standard read them. An opened card's second paragraph exists only in the island's bundle, and those checks do not read it. The do-not-claim guard reads `deck.ts` as source, and the deck test holds each second paragraph to one or two sentences. The deck is a typed module held by its test. It has no generated canon page and no entry in [`scripts/canonical_sets.ts`](../../../scripts/canonical_sets.ts).

## Glyphs

A glyph is data: a list of primitives on a 48-unit grid, each painted in one of the tones `glyph_grammar.ts` defines. [`Glyph.tsx`](../../../site/wall/Glyph.tsx) draws every glyph, so the set shares one grid, stroke, and weight. [`glyphs.ts`](../../../site/wall/glyphs.ts) authors one drawing per benefit card, keyed by card id. `glyphDrawing` returns the authored drawing for a name, or a seeded drawing computed from the name alone, so no card is ever blank and both renders agree.

Server and browser must serialize a glyph to the same markup. `Math.sin`, `Math.cos`, and `Math.sqrt` can differ in their last bit between engines. The grammar therefore computes angles and lengths with arithmetic the language specifies exactly and rounds every coordinate before it leaves the module. A structural guard in the glyph test rejects anything in the glyph modules that could vary between renders.

The split triangle of the discern mark is a rare accent. The glyph test counts every triangle form and allows at most one glyph in eight to draw one. The recursive triangle stays reserved, as the visual identity requires.

A drawing may mark one primitive to shift a few units while its card is hovered. The renderer hands that distance to the stylesheet as `--wall-glyph-dx` and `--wall-glyph-dy`. `wall-glyph.css` paints every tone from `currentColor`, and the glyph test fails when the renderer emits a class the stylesheet does not style.

## Knobs and the tuning panel

[`WALL_KNOBS`](../../../site/wall/tuning/knobs.ts) is the single table of tunable values: each knob's name, label, unit, range, step, and default. The server writes every default as a `--wall-<name>` custom property in the wall root's inline style. The stylesheets read those properties with no fallback value, so a stylesheet cannot carry a second default.

The island test enforces the contract. Every `var(--wall-*)` in a wall stylesheet must name a knob, a property a wall stylesheet declares, or a property a `site/wall` source writes. A `var()` with a fallback fails.

Add a knob by adding one entry to the table and reading its property in a stylesheet or a source file. The panel lists whatever the table holds.

The tuning panel is a development aid. It appears only when the address carries a `tune` query parameter, as in `/?tune`, and only after the island has mounted. It shows one range control per knob, copies the current values as JSON, and resets them to the defaults. The panel edits the same inline properties the server wrote, so a change shows in place. The site carries its own panel because the Content Security Policy refuses the run-time styles that third-party panels inject.

## Motion contract

Calm motion is a requirement of the page. These rules bind every stylesheet and hook on the wall:

- **Pointer travel moves nothing.** [`useLight`](../../../site/wall/use_light.ts) writes where the light is, in viewport coordinates, to `--wall-light-x` and `--wall-light-y`, at most once per frame. The stylesheets turn those lengths into brightness and never into movement.
- **Hover changes only the hovered card.** No other card lights, dims, or shifts.
- **Scroll moves the wall as one plane.** The approach brings the plane from far and tilted to near and flat. Cards never move relative to each other.
- **A lens changes opacity and saturation only.** It never scales or repositions a card.
- **Phones and reduced motion get the flat wall from the start.** So does a browser that cannot stage the approach.
- **Movement is cheap to draw.** Cards and the plane move through `transform` and fade through `opacity` and `filter`. No stylesheet uses `backdrop-filter`, and no hook reads layout while the pointer moves.
- **Nothing keeps moving by itself at the shipped defaults.** The wall fades in once. Ambient drift is a knob whose default is zero, and while drift is on, the wall shows a pause control.

The approach itself is CSS. Where the browser supports scroll-driven animation, [`wall.css`](../../../site/page-src/wall.css) ties the plane's tilt and distance to scroll, and no script measures or moves anything while the page scrolls. The page is complete without script in either state.

[`use_stage.ts`](../../../site/wall/use_stage.ts) defines a stage as an id and a `mount` function that takes the wall root and returns the function that restores it. `useStage` runs one stage and marks the root with its id. The approach is the only stage, and the interface exists so another can replace it.

The stage sets `data-wall-near` whenever the plane is flat and carries no transform. An effect that needs viewport-fixed coordinates, such as the pointer light on card borders, applies only under that attribute, because a fixed background breaks inside a transformed ancestor.

## Guards

- [`tests/site_wall_island_test.ts`](../../../tests/site_wall_island_test.ts) holds the island boundary. Only `island.tsx` imports `react-dom/client`, and no module imports the island. The served wall equals the component's render. The built bundle is fresh and named by its digest. The island loads on `/`, and no other live route loads a script that contains a React runtime. The test finds a runtime by script content, through imports, under any file name.
- [`tests/site_design_system_runtime_test.ts`](../../../tests/site_design_system_runtime_test.ts) keeps the island out of the production server's module graph and applies the same content check to every bundle route.
- [`tests/site_homepage_browser_test.ts`](../../../tests/site_homepage_browser_test.ts) loads the page in a real browser at phone and laptop sizes. Without script, every card's copy is visible and no control shows. With script, the island adopts the server's element under the production Content Security Policy with no page error, console error, or console warning. The lens, the opened card, keyboard focus, and the tuning panel then respond.
- [`tests/site_wall_deck_test.ts`](../../../tests/site_wall_deck_test.ts) resolves every citation, holds copy to the wall's length limits, checks that every card link leads to a manual page, ties each numeral to its inventory, and requires neighbors on the wall to span several clusters.
- [`tests/site_wall_glyph_test.ts`](../../../tests/site_wall_glyph_test.ts) holds the glyph vocabulary, the triangle budget, and exact arithmetic, and checks that the glyph stylesheet styles everything the renderer emits.
- [`tests/site_ui_test.ts`](../../../tests/site_ui_test.ts) applies the shared component boundary to `site/wall`: no `dangerouslySetInnerHTML`, and no design-system class name written by hand.
- [`tests/site_accessibility_test.ts`](../../../tests/site_accessibility_test.ts) and [`tests/site_homepage_scaffold_test.ts`](../../../tests/site_homepage_scaffold_test.ts) audit the homepage's landmarks, its manual link, and its accessibility findings.
