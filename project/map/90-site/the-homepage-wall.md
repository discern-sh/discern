---
aliases:
  - homepage wall
  - benefit wall
  - wall island
  - React hydration
  - tuning panel
  - wall glyphs
  - pointer light
  - opened card
---

# The homepage wall

The homepage body is one wall of small cards between the shared site header and footer. Each card states one thing discern does. A visitor scans the cards in any order and brings one group to the head of the wall with a lens. Opening a card shows a second paragraph and a link into the manual.

The wall is the site's only hydrated React island ([ADR 0430](../_adr/0430-the-homepage-ships-one-hydrated-react-island.md)). The server renders the complete page, and the browser then hydrates the wall so its controls respond. No other route sends a framework runtime to the browser.

## Where each concern lives

Components, hooks, and data live in [`site/wall/`](../../../site/wall/). Stylesheets live in `site/page-src/`.

| Concern                                                    | Source                                                                                                                                                                                                         | Guard                                                                                                                                                                  |
| ---------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Document shell, island host, and link labels               | [`HomePage.tsx`](../../../site/ui/pages/HomePage.tsx)                                                                                                                                                          | [`site_wall_island_test.ts`](../../../tests/site_wall_island_test.ts)                                                                                                  |
| Page body and root state                                   | [`WallPage.tsx`](../../../site/wall/WallPage.tsx)                                                                                                                                                              | [`site_homepage_browser_test.ts`](../../../tests/site_homepage_browser_test.ts)                                                                                        |
| Seam between server render and island                      | [`host.ts`](../../../site/wall/host.ts), [`island.tsx`](../../../site/wall/island.tsx)                                                                                                                         | [`site_wall_island_test.ts`](../../../tests/site_wall_island_test.ts)                                                                                                  |
| Built assets, the island's file name, and its cache policy | [`assets.ts`](../../../site/wall/assets.ts), [`site/build.ts`](../../../site/build.ts), [`site/serve.ts`](../../../site/serve.ts)                                                                              | [`site_wall_island_test.ts`](../../../tests/site_wall_island_test.ts), [`site_design_system_runtime_test.ts`](../../../tests/site_design_system_runtime_test.ts)       |
| Data contract, cards, lenses, cluster hues                 | [`types.ts`](../../../site/wall/types.ts), [`deck.ts`](../../../site/wall/deck.ts), [`clusters.ts`](../../../site/wall/clusters.ts)                                                                            | [`site_wall_deck_test.ts`](../../../tests/site_wall_deck_test.ts)                                                                                                      |
| A card's markup, surfaces, and states                      | [`Card.tsx`](../../../site/wall/Card.tsx), [`wall-card.css`](../../../site/page-src/wall-card.css)                                                                                                             | [`site_wall_card_test.ts`](../../../tests/site_wall_card_test.ts)                                                                                                      |
| The lens and receded cards                                 | [`Lens.tsx`](../../../site/wall/Lens.tsx), [`wall-interactions.css`](../../../site/page-src/wall-interactions.css)                                                                                             | [`site_wall_interactions_test.ts`](../../../tests/site_wall_interactions_test.ts), [`site_homepage_browser_test.ts`](../../../tests/site_homepage_browser_test.ts)     |
| The opened card                                            | [`OpenCard.tsx`](../../../site/wall/OpenCard.tsx), [`use_open_card.ts`](../../../site/wall/use_open_card.ts), [`wall-interactions.css`](../../../site/page-src/wall-interactions.css)                          | [`site_wall_interactions_test.ts`](../../../tests/site_wall_interactions_test.ts), [`site_wall_sheet_browser_test.ts`](../../../tests/site_wall_sheet_browser_test.ts) |
| Glyph vocabulary, drawings, renderer, and pose             | [`glyph_grammar.ts`](../../../site/wall/glyph_grammar.ts), [`glyphs.ts`](../../../site/wall/glyphs.ts), [`Glyph.tsx`](../../../site/wall/Glyph.tsx), [`wall-glyph.css`](../../../site/page-src/wall-glyph.css) | [`site_wall_glyph_test.ts`](../../../tests/site_wall_glyph_test.ts), [`site_wall_glyph_motion_test.ts`](../../../tests/site_wall_glyph_motion_test.ts)                 |
| Pointer light                                              | [`use_light.ts`](../../../site/wall/use_light.ts), [`wall.css`](../../../site/page-src/wall.css), [`wall-card.css`](../../../site/page-src/wall-card.css)                                                      | [`site_wall_light_test.ts`](../../../tests/site_wall_light_test.ts)                                                                                                    |
| The stage, the approach, and keyboard focus                | [`use_stage.ts`](../../../site/wall/use_stage.ts), [`wall.css`](../../../site/page-src/wall.css)                                                                                                               | [`site_homepage_browser_test.ts`](../../../tests/site_homepage_browser_test.ts), [`site_wall_island_test.ts`](../../../tests/site_wall_island_test.ts)                 |
| Tunable values and the tuning panel                        | [`tuning/knobs.ts`](../../../site/wall/tuning/knobs.ts), [`tuning/Panel.tsx`](../../../site/wall/tuning/Panel.tsx)                                                                                             | [`site_wall_island_test.ts`](../../../tests/site_wall_island_test.ts), [`site_homepage_browser_test.ts`](../../../tests/site_homepage_browser_test.ts)                 |

This page names each test by its subject. The browser test is `site_homepage_browser_test.ts`, the sheet test is `site_wall_sheet_browser_test.ts`, and the glyph motion test is `site_wall_glyph_motion_test.ts`. The island, deck, card, glyph, interactions, and light tests are the `site_wall_*_test.ts` files of those names.

`WALL_STYLESHEETS` in `assets.ts` lists the wall's stylesheets in cascade order, and the build copies each one beside the homepage's design-system bundle:

| Stylesheet                                                              | Styles                                                                                                                                                                                                                                                |
| ----------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [`wall.css`](../../../site/page-src/wall.css)                           | The room, the headline pool, the stage and its approach, the lens bar's place and its two fades, the link past the cards, the face colors and the cluster accent, the light on the canvas, and the forced-colors, more-contrast, and print fallbacks. |
| [`wall-card.css`](../../../site/page-src/wall-card.css)                 | Card surfaces, the light on card borders, the rest, hover, focus, and pressed states, and the one-column layout.                                                                                                                                      |
| [`wall-glyph.css`](../../../site/page-src/wall-glyph.css)               | Glyph tones, strokes, and the pose a lit card's glyph holds.                                                                                                                                                                                          |
| [`wall-interactions.css`](../../../site/page-src/wall-interactions.css) | Lens chips, the divider, receded cards, the opened card, and its transitions.                                                                                                                                                                         |
| [`wall-tuning.css`](../../../site/page-src/wall-tuning.css)             | The tuning panel.                                                                                                                                                                                                                                     |

Each kind of movement has one element. Hover transforms belong to `.wall-card-face`. The scroll approach transforms `.wall-plane`. The drawing of a glyph that travels moves on its own box. The list item `.wall-card` changes only opacity and filter, and the list's order alone places it. Keeping them apart stops a transform in one stylesheet from replacing a transform in another. The card test fails when `wall-card.css` moves or fades the list item, and the interactions test fails when `wall-interactions.css` moves it.

`wall.css` declares the colors of a face once, on the page's root, where the pictures of a view transition can read them. They are the foot every face ends on, a card's head, and the sheet's lighter head. The same stylesheet works out a cluster's accent from its hue for a card, the sheet, and a chip's dot.

## Server render and hydration

[`renderLanding`](../../../site/ui/pages/HomePage.tsx) renders `WallPage` to markup inside the host element `#wall-island` and writes the props it used to that element's `data-wall-props` attribute. The island reads them back through `decodeWallProps`, which refuses a malformed value, and hydrates the host with the same component.

The props are plain text and one table of text: the mark, the version, the headline, the category line, and `linkLabels`. That table gives the title of each manual page a card links to, by route. [`host.ts`](../../../site/wall/host.ts) defines the props and imports nothing, so the server and the build read the seam without loading the wall. The deck, lenses, and knob table are modules the component imports on both sides.

Only the server can read the manual. `HomePage.tsx` loads it once as the module loads and takes each linked page's title from it. A card that links to a page the manual does not publish stops the render.

Hydration has nothing to reconcile only while both renders produce the same markup. These rules keep them equal:

- `WallPage` and everything under it read no clock, no randomness, and nothing from the browser before an effect runs.
- No component calls `useId`. An element id is a fixed string or derives from a card id.
- The site build formats every generated page, and reformatting the wall's markup would change the nodes React expects. `HomePage.tsx` places a formatter directive before the host so the formatter leaves that element alone.

The island test proves the result: the served homepage contains the bytes that `renderToString` produces from the props on the host. The built island carries the production build of React, which keeps the server's attributes without a word when the browser's first render disagrees with them. The browser test therefore hydrates the served page once more with a bundle made with minification off, which carries the development build. That case fails on any console message other than a log or an info message, through hydration, a lens, and an opened card.

The page works before script runs. Every card's front, the headline, and the call to action are server markup. A card's second paragraph and its manual link exist only in the island. The lens bar needs script, so it stays hidden until the island sets `data-wall-live`. A card's heading is a button in server markup. Until the island is live, that button opens nothing and shows no pointer cursor, though the keyboard still stops on it. The opened card and the tuning panel never appear in server markup. `OpenCard` renders nothing until a card is open, and the wall checks the address for the panel's parameter only after it mounts.

The browser test loads the page with script off at phone and laptop sizes. It requires every card's copy to show, nothing left hidden or faded once the wall is flat, and no visible button that invites a press. On the laptop it also tabs onto the stage and requires the plane to lie flat under that focus, which the stylesheet does with no script.

The wall root `.wall` carries the page's state for the stylesheets. Every knob is an inline `--wall-<name>` custom property. Script adds data attributes as the state changes: `data-wall-live` once the island has hydrated, `data-wall-drift` and `data-wall-paused` for the drift knob, and the stage's mark, `data-wall-near`. The doc comments on [`WallPage`](../../../site/wall/WallPage.tsx) and in [`use_stage.ts`](../../../site/wall/use_stage.ts) list every attribute and its meaning. Script sets them all, so nothing a reader needs may depend on one.

## The build step

[`buildSite`](../../../site/build.ts) bundles the island before it renders any page, because the homepage links the bundle by a name only the build knows. [`bundleBrowserModule`](../../../site/page-src/format-generated.ts) runs `deno bundle --platform browser --minify` on `island.tsx`. It resolves React through the repository's import map and lockfile. Its `minify` option exists for the development-React case in the browser test. The bundle step and the generated-page formatter share one [registered spawn boundary](../50-engine-internals/subprocess-boundaries.md).

[`wallIslandFile`](../../../site/wall/assets.ts) turns the bundle into the file the build publishes, `wall-island.<hash>.js`, beside the wall's stylesheets. The hash is the leading hexadecimal digits of the SHA-256 digest of the file's own bytes, so a page cannot pair with a bundle built from other markup. No other module under `site/` spells that name. `wallIslandContentHash` reads the hash back from a file name.

The same function refuses a bundle that is not the island. `wallIslandFault` requires the script to name the host element and to carry a React runtime. A bundle step that ends without a fault and with empty or partial output therefore stops the build. No homepage ships with controls that never come alive.

[`renderMarketingPage`](../../../site/renderers.ts) takes the generated file names as an optional argument. The build passes the island's name. Every other caller, such as the prose checks, omits it and receives the same document without the script. The build fails unless the island's name appears in the homepage and in no other page.

[`site/serve.ts`](../../../site/serve.ts) serves a file whose name carries that hash with `cache-control: public, max-age=31536000, immutable`. A new build publishes new bytes under a new name, so a cache never needs to ask again. Every other bundled file keeps the five-minute policy.

[`SITE_BUILD_INPUTS`](../../../site/build_inputs.ts) includes `site/wall`, so the watcher rebuilds after a wall edit. It also includes `site/docs.tsx` and `project/manual`, because the homepage's markup carries the manual's page titles. Deno labels `deno bundle` experimental. The island test compares the built file with a fresh bundle of its entry, so a stale build or changed `deno bundle` output fails there.

## The deck

[`deck.ts`](../../../site/wall/deck.ts) authors the cards by cluster, in the benefit canon's order, so the copy for one family of outcomes reads together. `WALL_DECK` is the same set in display order. It opens on `WALL_LEAD`, ten card ids in an authored order. After the lead, a golden-ratio sequence scatters each cluster through the wall and spaces the statement and numeral cards among the benefit cards. The order depends only on each card's position in the authored list, so the server and the browser agree.

A lens lists the cards it keeps in display order. The lead holds a card from every lens, so each lens opens on an authored card too. The list fills its columns one after another, so on a wide screen the lead runs down the first column.

[`types.ts`](../../../site/wall/types.ts) defines the card kinds. A benefit shows a glyph, a title, and one line. A statement shows one short sentence. A numeral shows a number, a title, and one line. A card's `href` names a manual page and may end in `#` and the id of a heading on that page. Every card names its `source` and the entry it `cites`:

| Source          | Registry                                                                                                         |
| --------------- | ---------------------------------------------------------------------------------------------------------------- |
| `human-benefit` | The human benefit canon in [`scripts/feature_registry.ts`](../../../scripts/feature_registry.ts)                 |
| `agent-benefit` | The agent benefit canon in the same module                                                                       |
| `consequence`   | Consequences written for the person in [`scripts/brand/consequences.ts`](../../../scripts/brand/consequences.ts) |
| `claim`         | The claims ledger in [`scripts/brand/claims.ts`](../../../scripts/brand/claims.ts)                               |

A human-benefit card takes the benefit's registry id as its own id. `WALL_ABSENT` names any human benefit the wall omits and gives the reason. The deck test fails when a human benefit is neither a card nor listed there.

A numeral card states a count as fact, so the count comes from its inventory. The agent names come from [`agent_catalogue.ts`](../../../src/shared/agent_catalogue.ts) when the page renders. The count of discern's own quality limits is a constant, because `deck.ts` also runs in the browser, where it cannot read `discern.toml`. The deck test holds that constant equal to the file. On the published site, `src/` comes from the released product ([Publish a website update](publishing.md#publish-a-website-update)), so the wall names the agents that release supports and shows its version.

`WALL_LENSES` gives each lens a label and the clusters it gathers. Between them the lenses cover every cluster, and the deck test fails on a cluster no lens gathers. A lens sets aside the cards outside its clusters and removes none. `clusters.ts` gives each cluster one hue, which a card passes to the stylesheets as `--wall-hue`.

Card fronts are server markup, so the [public-site prose checks](design-system-consumption.md#public-site-prose) and the reading-grade standard read them. Some words reach the page only through script: an opened card's second paragraph, the divider a lens draws, and the lens's status sentence. `SCRIPT_SHOWN_PROSE` in [`scripts/site_prose_lib.ts`](../../../scripts/site_prose_lib.ts) adds them to the homepage's projection, so the same checks read those too. It takes each card's second paragraph from the deck, the divider's words from `LENS_REST`, and one sentence per lens from `lensStatus`. [`tests/site_prose_test.ts`](../../../tests/site_prose_test.ts) fails when the projection lacks any of them. The do-not-claim guard reads `deck.ts` as source. The deck is a typed module held by its test. It has no generated canon page and no entry in [`scripts/canonical_sets.ts`](../../../scripts/canonical_sets.ts).

The deck test holds the copy to these rules:

- Titles, lines, statements, and second paragraphs stay inside the length limits the test names as constants.
- A numeral card's title never says its number again, as a figure or as a word. The heading reads as the numeral and then the title.
- A span of minutes on a card is one the manual's setup page states.
- Every link leads to a page the manual publishes, and a link to a section names a heading on that page.

## Cards

[`Card.tsx`](../../../site/wall/Card.tsx) renders each card as one list item, `li.wall-card`. The item carries its kind as a modifier class and its cluster hue as `--wall-hue`. Inside it, `div.wall-card-face` holds an empty box for the [pointer light](#the-pointer-light), the glyph on a benefit card, the heading, and the line. The heading holds the card's one button, which the stylesheet stretches over the face. A numeral card's number sits inside that button, so assistive technology reads the number once, as part of the heading.

A card is lit while its button has keyboard focus or a pointer that can hover is over it. A lit card's face lifts slightly, its border takes the card's hue, and its glyph holds its pose. Under a pointer the face also leans toward it, by the `hover-tilt` knob's angle at most. `Card.tsx` writes the pointer's place inside the hovered card to `--wall-pointer-x` and `--wall-pointer-y` on the list item. It measures the card once as the pointer enters, and each move after that is arithmetic on that box until the pointer leaves.

Where the list is one column, a benefit card sets its glyph beside its words, which shortens a phone's page. The width `wall-card.css` names for that layout is the widest viewport at which the list has one column.

The browser scrolls to a focused card's button, which is the heading's box alone. The button therefore carries two scroll margins. The first brings the card to rest clear of the pinned lens bar. The second is as tall as the tallest foot a card has under its heading, so the card's foot comes into view too.

[`site_wall_card_test.ts`](../../../tests/site_wall_card_test.ts) holds the card's rules:

- Every card in the deck renders its kind's markup, and assistive technology reads each card's words once, in reading order.
- Hover rules apply only where a pointer can hover, so a tap leaves no card lit.
- The tilt stays within the knob's angle, and the lift within the test's pixel bound.
- The browser draws a face that moves or lights over the other cards until it rests. A moving layer in the middle of the wall would make the browser redraw every later card.
- Every outer shadow takes its size from the gap between cards, so no shadow reaches a neighbor.
- The wall sets sans-serif type only.
- Print and forced colors get flat cards in system colors.
- A card the keyboard reaches going backward comes to rest clear of the pinned bar.
- A heading wraps a word longer than its card, and the glyph sits beside the words where the list is one column and at no wider viewport.
- Every control that draws its own look, in any wall stylesheet, takes no tap highlight from the browser. A view transition's picture of the page would otherwise catch the highlight.

## Glyphs

A glyph is data: a list of primitives on a 48-unit grid, each painted in one of the tones `glyph_grammar.ts` defines. [`Glyph.tsx`](../../../site/wall/Glyph.tsx) draws every glyph, so the set shares one grid, stroke, and weight. [`glyphs.ts`](../../../site/wall/glyphs.ts) authors one drawing per benefit card, keyed by card id. `glyphDrawing` returns the authored drawing for a name, or a seeded drawing computed from the name alone, so no card is ever blank and both renders agree.

Server and browser must serialize a glyph to the same markup. `Math.sin`, `Math.cos`, and `Math.sqrt` can differ in their last bit between engines. The grammar therefore computes angles and lengths with arithmetic the language defines to the last bit, and it rounds every coordinate before it leaves the module. A structural guard in the glyph test rejects anything in the glyph modules that could vary between renders.

The split triangle of the discern mark is a rare accent. The glyph test counts every triangle form and permits at most one glyph in eight to draw one. The recursive triangle stays reserved, as the visual identity requires.

### The traveling primitive

A drawing may mark one primitive to travel a few units while its card is lit. The renderer draws a glyph as a square box, `span.wall-glyph`, that holds two drawings of the same grid. The first, `svg.wall-glyph-art`, holds the primitives that stay still. The second, `svg.wall-glyph-move`, holds the traveling primitive alone and lies over the first, corner to corner. A glyph with no traveling primitive has the first drawing only.

The stylesheet moves the second drawing with `translate` on its box. The browser moves a box as one piece and lays nothing out again. A shape that moves inside a drawing has the browser lay out every drawing on the wall on each frame.

The renderer hands the distance to the stylesheet as `--wall-glyph-dx` and `--wall-glyph-dy`, each a percentage of the grid from `gridShare`. One value therefore serves the glyph on a card and the larger glyph in the sheet. `wall-glyph.css` keeps the move from costing anything beyond the drawing itself:

- **The second drawing always carries a move, of nothing at rest.** A box that goes from no `translate` to some `translate` gets a new layout, and so does everything laid out with it.
- **The ease runs on two lengths and never on the move.** `translate` reads `--wall-glyph-x` and `--wall-glyph-y`, two registered percentage properties that do not inherit, and the transition names those. A transition on `translate` itself makes the box a layer for as long as it runs, and a layer in the middle of the wall makes the browser redraw every later card.
- **The ease ends before the card's face steps back down.** `wall-card.css` keeps a lit face raised for a moment after it rests, and the ease is shorter than that hold.

The second drawing paints over the first, so a traveling primitive paints last wherever its drawing lists it. A drawing therefore lists nothing after a traveling primitive that crosses the box it sweeps.

Where a pointer can hover, the pose carries through the opening. The source card keeps the pose while the hook marks it, and the opened card draws its own glyph in the same pose. The glyph test reads the lit states from `wall-card.css`, so a change to how a card lights fails that test until `wall-glyph.css` follows. The test also fails when another module under `site/wall/` starts to draw a glyph, until someone decides its pose.

The glyph test holds each of these rules in the markup and the stylesheet. The glyph motion test watches a real browser. One hover on and off a card whose glyph travels must start no layout, and the glyph must rest before its face steps back. A glyph that eases on a face that is not raised must never become a layer. That test counts every layout during the hover, so a layout from any other cause fails it too.

### The set

A dashed stroke gives up part of its length to gaps. The renderer marks a dashed shape with a second class, and the stylesheet draws it heavier than a whole stroke so that it reads at card size. The glyph test requires a dashed stroke to keep most of a whole stroke's ink and to keep its gaps open at the heaviest weight the knob reaches.

`wall-glyph.css` paints every tone from `currentColor`, and the glyph test fails when the renderer emits a class the stylesheet does not style. The same test keeps the set even:

- A card in the deck draws every authored key.
- Each glyph carries a like share of ink and fills its grid.
- No two glyphs share a silhouette.
- No single device, such as an enclosing frame or a stack of rows, carries a family of glyphs.

The limits are constants in the test. A seeded glyph meets the ink and grid limits too.

## Knobs and the tuning panel

[`WALL_KNOBS`](../../../site/wall/tuning/knobs.ts) is the single table of tunable values: each knob's name, label, unit, range, step, and default. The server writes every default as a `--wall-<name>` custom property in the wall root's inline style. The stylesheets read those properties with no fallback value, so a stylesheet cannot carry a second default. A hook that needs a knob reads the same inline property from the root.

The island test enforces the contract in both directions:

- Every `var(--wall-*)` in a wall stylesheet must name a knob, a property a wall stylesheet declares, or a property a `site/wall` source writes. A `var()` with a fallback fails.
- Every `--wall-*` property a stylesheet declares, and every knob, must have a reader.
- A stylesheet must select every `data-wall-*` attribute a wall module writes, unless the test's `ATTRIBUTE_READERS` table names the module that reads it. No stylesheet may select an attribute that nothing writes.

Add a knob by adding one entry to the table and reading its property in a stylesheet or a source file. The panel lists whatever the table holds.

The tuning panel is a development aid. It appears only when the address carries a `tune` query parameter, as in `/?tune`, and only after the island has mounted. It shows one range control per knob, copies the current values as JSON, and resets them to the defaults. The panel edits the same inline properties the server wrote, so a change shows in place. The site carries its own panel because the Content Security Policy refuses the run-time styles that third-party panels inject.

## Motion contract

Calm motion is a requirement of the page. These rules bind every stylesheet and hook on the wall, and each names the test that fails on a breach:

- **Pointer travel moves nothing.** The light changes brightness and never geometry. The browser test sweeps a pointer across the flat wall. A card the pointer has not touched must keep its box, opacity, and filter at every stop, and every card must return to rest afterward.
- **Hover changes only the hovered card.** Its face may travel a short distance. The same sweep bounds that travel, and the card test bounds the tilt, the lift, and the shadows. A card near the pointer shows only a faint white ring on its border, and the card test rejects a hue in that ring.
- **Scroll moves the wall as one plane.** The approach transforms `.wall-plane` and nothing inside it. The browser test finds the plane tilted at the top of a laptop page, free of any transform once the wall is near, and tilted again after scrolling back. The page keeps its width and height throughout.
- **Keyboard focus lays the wall flat.** While keyboard focus is on the stage, the plane carries no transform, and the stage scrolls nothing. The browser test walks the keyboard down and back up the wall at two laptop sizes. Every card it reaches must be wholly in view at reading size, no sampled frame may show the plane tilted, and no focused card may sit under the lens bar. The island test requires every far-view rule to stand down under that focus. A pointer's press on that flat wall tilts nothing, and the sheet test requires the press to land.
- **A lens re-sorts the list, and no card travels.** The list's order alone places a card. The interactions test rejects any property that would move or resize a receded or opening card. The browser test requires the page to cross-fade once, with only the page's root taking part, and it holds the list's order and the page's place after every lens.
- **Opening a card moves one object and its mark.** The card grows into the sheet only from a flat card, and its glyph or numeral crosses with it. The interactions test holds those choices, and the sheet test requires the page to return to rest after every way out.
- **A glyph moves one primitive, by a few units, on a lit card.** The glyph test bounds the travel and ties the pose to the card's lit states. The glyph motion test requires the move to start no layout and to make no layer.
- **Phones and reduced motion get the flat wall from the start.** The browser test checks a phone at load, and reduced motion both at load and when the preference changes under a loaded page.
- **Reduced motion stills the rest.** The card test and the glyph test hold their stylesheets to `MOTION_PROPERTY` in [`tests/wall_stylesheets.ts`](../../../tests/wall_stylesheets.ts). Every property that moves a box or times a change must sit inside a `prefers-reduced-motion: no-preference` block. The interactions test requires a card to open with a cut. The light test requires the light to appear and go with no fade, and one pointer move to write the light once. The glyph motion test requires a lit card's glyph to stay where it is. Under reduced motion, the browser test requires the lens bar to arrive with no transition of its own and a lens to re-sort the wall with no view transition, and it opens every card in the deck.
- **A finger moves nothing.** The browser test draws a finger across the wall and fails when any attribute inside the wall changes.
- **Movement is cheap to draw.** Cards animate `transform` and `opacity`, and the list item fades through `opacity` and `filter`. The card test rejects `backdrop-filter` and any background fixed to the viewport, in every wall stylesheet. The light test bounds what one style recalculation touches during pointer travel, the wall's arrival, and a step of the keyboard. It also fails when a pointer handler, a scroll handler, or a frame makes the browser lay the page out.
- **Nothing keeps moving by itself at the shipped defaults.** The wall fades in once. Ambient drift is a knob whose default is zero, and while drift is on, the wall shows a pause control. The browser test asserts the default, the absent control, and that the control pauses the drift.

Some parts of the contract have no test, and [`project/TODO.md`](../../TODO.md) carries each:

- No test runs a browser that lacks scroll-driven animation, which gets the flat wall too.
- No test holds the rule that a card takes its receded look at once inside a lens's cross-fade, instead of fading a second time.
- No test changes `(hover: hover)` or the `light-radius` knob under a still pointer to see the light ask for a new report.

### The approach

The approach itself is CSS. Where the browser supports scroll-driven animation, [`wall.css`](../../../site/page-src/wall.css) ties the plane's tilt and distance to scroll. The headline pool leaving the viewport times it, so the wall is flat when its top reaches the top of the viewport. No script measures or moves anything while the page scrolls. The stylesheet stages the approach only on a large screen with a fine pointer that can hover, and only for a visitor with no reduced-motion or forced-colors preference. The page is complete without script in either state.

[`use_stage.ts`](../../../site/wall/use_stage.ts) defines a stage as a `mount` function that takes the wall root and returns the function that restores it. `useStage` runs one stage. The approach is the only stage, and the interface exists so another can replace it.

The stage sets `data-wall-near`, which the module exports as `NEAR_ATTRIBUTE`, whenever the plane is flat and carries no transform. That holds where the stylesheet stages no approach, once the pool has left the viewport, and from the moment keyboard focus reaches the stage until the focus leaves it. The far-view rules in `wall.css` stand down under that attribute, and the light reaches card borders only under it.

### Keyboard focus and the far view

A card in the far view is too small to read, and the browser cannot scroll to a card that it draws away from where the card lies. Keyboard focus on the stage therefore means a flat plane. The browser then brings a focused card into view by itself, and the stage scrolls nothing.

The stylesheet does this with no script. Each far-view rule in `wall.css` stands down under `:focus-visible`, and each looks for that focus from the box it styles:

- The stage drops its perspective while the focus is anywhere on the stage.
- The plane drops its tilt while the focus is on a card or on the link past the cards.
- The lens bar shows whole while the focus is inside the bar.

The hook mirrors the stylesheet. `KEYBOARD_ON_STAGE` in `use_stage.ts` is the stage rule's own selector, and the hook marks the root near once it matches. The plane is then flat under a focused lens chip too, and the light's reach agrees with the plane. The selector leaves the pause control out, so focus on that control does not end the view it pauses.

The hook then keeps the mark for as long as the focus stays anywhere on the stage, whatever moves it. A pointer's press takes the focus without the keyboard's mark, so the rules in the stylesheet stop standing down as the press lands. Left to them, the plane would tilt away between the press and its release, and the click would miss its card or chip. Every far-view rule also requires a root that is not near, so the hook's mark keeps them all off through the press.

- A press on one of the stage's controls keeps the mark even when it leaves the focus nowhere. Some browsers give a pressed button no focus and take the focus from whatever held it.
- The far view returns when the focus leaves the stage any other way.
- A modal layer that borrows the focus, as an opened card does, leaves the mark as it stood.

No rule may look for that focus from the wall root. A `:has()` on `.wall` makes the browser restyle the wall at every step of the keyboard. A rule under a root state that styles every child of a box by no name costs the same. The guards:

- The island test rejects `:has(` on the root's own part of any selector in a wall stylesheet. It also requires every far-view rule to stand down, and the stage's rules to use `KEYBOARD_ON_STAGE` whole.
- The light test holds a step of the keyboard, and the wall's arrival and departure, to the same restyle budget as pointer travel.
- The sheet test lays the wall flat for the keyboard at the top of a laptop page and presses a card and a chip with a pointer. Each press must land, and the wall must stay flat until the focus leaves the stage. It repeats the press on a page where a press leaves the focus nowhere.

The stage's first control is a link, "Skip the cards". The stylesheet draws it only while it holds the focus. It leads to the closing section's heading, which takes the focus.

### The lens bar's arrival and exit

The lens bar arrives over the last of the approach. It only fades, so an unseen bar stays in the tab order and in the accessibility tree. Its chips take no press until the bar is half seen. The browser test looks at the unseen bar at the top of a laptop page. The bar must be in the accessibility tree, take the keyboard's focus, and take no press.

At the foot of the wall the bar fades out as the closing section comes in, and its chips take no press once the bar is half gone. No screen then ends with the bar cut by the viewport's edge. That fade follows scroll, so it runs under reduced motion too. Keyboard focus inside the bar shows it whole wherever the page stands, and so does a press on the bar. A pointer that presses a chip there takes the focus from the keyboard, and the bar stays under the press. The sheet test presses a chip at the foot of the page. On a screen shorter than 30rem the bar stays at the head of the wall instead of pinning. The browser test holds the fade at the foot of the page and the unpinned bar on a short screen.

## The pointer light

One light follows a mouse or pen across the wall. [`useLight`](../../../site/wall/use_light.ts) writes its place and its brightness, at most once per frame. The stylesheets draw it on the canvas and on card borders:

- **On the canvas.** `.wall::before` is one soft disc under everything in the room. The hook writes the light's place, measured from the wall root's corner, to `--wall-light-x` and `--wall-light-y` on the root. It writes how far the light has come up to `--wall-light-on`. The disc follows through `translate` and fades through `opacity`.
- **On card borders.** Each card's face holds an empty box, `span.wall-card-light`, masked down to the one-pixel border ring. For each card within reach of the light, the hook writes the light's place from that card's own corner to `--wall-card-light-x` and `--wall-card-light-y` on that box, with `--wall-card-light-on` beside them. It removes all three when the card falls out of reach. The ring is white and faint, the same on every card the light reaches. A card shows its own hue only while it is lit.

The stylesheet decides the reach. `--wall-light-reach` on the root is zero at rest. It equals the light's throw only under `.wall[data-wall-near]`, on a screen with a pointer that can hover. So no card takes the light while the plane tilts away, or on a touch screen. `LIGHT_REACH_GATES` in `use_light.ts` names those two conditions, and a change in either makes the hook read the reach again. A rule that set the reach by any other state would change it unseen, so the card test fails on such a rule. It also requires the reach and the box's own gradient to name the same throw.

### What a frame costs

A custom property inherits unless a stylesheet registers it otherwise. An inheriting property written on the root every frame makes the browser restyle every element in the wall every frame. The stylesheets therefore register each property that script writes during pointer travel with `@property` and `inherits: false`. A box takes one only by declaring `<name>: inherit`, and only a box that draws with the value may ask.

A browser that restyles an element also looks again at that element's children. The border light therefore lives on an empty box. On the face, the same value would cost the glyph, the heading, and the line a second look each frame.

A frame of pointer travel restyles the root with its pseudo-elements and its three sections, and one empty box in each card near the pointer. The card under the pointer restyles its own face as well, and a card restyles whole once as the pointer enters or leaves it. None of those counts grows with the deck.

Selected text costs too. The browser works out an element's `::selection` style each time it restyles that element, and a highlight rule that reads a design-system token is slow to work out. `wall.css` names the room's selection colors itself and reads no token. Selected words keep their own color on a blue wash, which stays readable in both site themes.

### Where the light reads layout

No pointer handler, scroll handler, or frame of the light reads layout or a computed style. A read there makes the browser finish its pending style and layout inside that handler. The hook reads everything in the report of one `ResizeObserver`, which the browser delivers once it has laid the page out:

- where the wall root is on the page, and how far the page has scrolled;
- the computed reach;
- each card's box, from layout offsets, which ignore transforms, so a lifted face reads the same as one at rest.

The observer watches the document, the wall root, and every light box, and it reports by itself when one of them changes size. A change that moves the wall or its cards and resizes nothing needs the hook to ask for a report. The hook asks, by observing a box afresh, when:

- the page scrolls under the pointer;
- anything inside the wall joins it, leaves it, or changes order, as a lens re-sort does;
- `data-wall-near` or `(hover: hover)` changes;
- the `light-radius` knob changes.

Every frame between reports is arithmetic on what the last report found and on the knobs. A reorder made in a stylesheet alone, with no change to the list's children and no change of size, would reach the hook through none of these.

A handler reads layout in a single place: a card measures itself as the pointer crosses into it.

### How the light comes and goes

- The light comes up where the pointer is and goes down where it stands, over the `light-fade` knob's milliseconds. It never sweeps in from an edge.
- While up, it eases toward the pointer over the `light-ease` knob's milliseconds and stops writing once it arrives. A still pointer costs nothing.
- A pointer that jumps farther than the light's own size draws no light across the wall. The light goes dark in place and comes up at the pointer.
- A page that scrolls under a still pointer moves the pointer's place on the wall, and the light follows the same way.
- Reduced motion removes the fade and the ease. The light is where the pointer is, at once.
- Touch never moves the light, and it holds still while the pointer is over an opened card.
- Forced colors and print draw neither the disc nor the boxes.

[`site_wall_light_test.ts`](../../../tests/site_wall_light_test.ts) holds the light through plain, stylesheet, and browser tests:

- Plain tests check the arithmetic of `lightStep`, `lightFrame`, and `lightGap`, at the pace `lightPace` builds from the knob table.
- Stylesheet tests take the list of frame-written properties from `LIGHT_PROPERTIES` in `use_light.ts` and `POINTER_PROPERTIES` in `Card.tsx`, so a new property enrolls itself. Each must register as non-inheriting. No state of the wall root may change an inheriting property. No highlight rule in a wall stylesheet may read a `--discern-` token.
- A browser test traces a pointer sweep, one move to a frame, and fails when one style recalculation touches more elements than the test's budget. Two moves in one frame restyle two frames' worth of boxes, so a sweep left to the machine's own pace would measure the machine.
- The same test repeats the sweep on a wall with every card cloned. The budget must still hold, and the sweep's total may grow by no more than the test's ratio. A cost that grew with the wall would double.
- Two more browser tests hold the wall's arrival and departure, and a step of the keyboard, to the same budget.
- A trace test leaves style and layout pending before every pointer and scroll handler runs. It then fails on any layout or style recalculation that ran inside an event's dispatch or a frame callback. The card's own read at a crossing is the exception. The test requires the trace to show that read, which proves the trace would show any other.
- A further test moves the wall down the page, scrolls the page under a still pointer, and swaps two cards of one size. The light must stay under the pointer each time.
- Further browser tests watch the light come up, jump, and go down. They require no write at rest or over an opened card, and none from a finger.

## The lens and receded cards

The lens bar sits at the top of the wall and stays pinned as the reader scrolls. [`Lens.tsx`](../../../site/wall/Lens.tsx) renders "Everything" and one chip per `WALL_LENSES` entry. Each chip is a toggle with `aria-pressed`, and pressing the active chip lets the lens go. A lens chip carries one dot per cluster it gathers, in that cluster's hue. Where the chips do not fit one row, they form a strip that scrolls sideways, and a chosen or keyboard-focused chip moves to its middle. A little under the width where the row fits, the chips close up, so the row still fits a common laptop.

A lens re-sorts the list. `lensGroups` splits the deck into the cards the lens kept and the rest, each group in the deck's own order. `WallPage` renders the kept cards, then one divider, then the rest. The divider is a list item, `li.wall-rest`, that reads "Everything else" and spans every column. A card keeps its element when the order changes, so the list's order is the only thing a lens moves. With no lens the list is the deck and holds no divider.

A card under the divider recedes. It carries `data-receded`, and `wall-interactions.css` lowers its opacity and removes nearly all its color. The card stays in the list, where a visitor can still read, focus, and open it. Pointing at a receded card, or reaching it by keyboard, brings that one card back up.

The opacity has a floor. A receded card's title and line must both keep a contrast of at least 4.5 to 1. The interactions test computes that contrast from the stylesheets' own colors. The loss of color is what makes the card read as receded.

`useLens` owns the active lens and how a change shows:

- **One cross-fade, or a cut.** Where the browser has view transitions and the visitor has not asked for reduced motion, the page cross-fades once, as one picture, from one order to the other. Otherwise the change is a cut. No card has a transition part of its own, so no card travels across the screen.
- **A jump to the head of the wall.** The kept cards now lead the wall. In the same frame, a reader who has scrolled past the head of the wall comes back to it at once. A reader who can see the head stays put. `.wall-list` sets `overflow-anchor: none`, or the browser would scroll the page after whichever card it had anchored.
- **The last request wins.** Each request states the lens the wall should end with, and a later cross-fade ends an earlier one where it stands.
- **A press made during the fade still lands.** While the cross-fade runs, the browser sends every click to the document's root. The first click ends the fade, and a plain one reaches what it fell on through `deliverClick`, the function [the opened card](#the-opened-card) uses.
- **A double click chooses once.** Its second click would let the chosen lens go again. [The click sequence](#requests-clicks-and-faults) drops it, under a cross-fade and under a cut.

The lens also says in words what it did, for a reader who cannot see the cards regroup. A status region, `p.wall-lens-status` with `role="status"`, sits inside the lens group. It is in the server's markup, empty, so assistive technology is already listening when a lens first fills it. `lensStatus` writes a sentence such as `9 cards for "Review less". The other 59 follow under "Everything else".` The stylesheet never draws the region.

The interactions test checks which cards each lens recedes, the two groups and their order, the status sentence, and the chips' pressed states. The browser test presses every lens at phone and laptop sizes. It requires:

- one row of chips, and no sideways page overflow;
- the list in the lens's order, with the divider across every column between the two groups, and the status in the same words;
- no card removed, and the deck's own order back once the lens goes;
- the page left where it stood from the head of the wall, and brought back to the head from further down;
- one cross-fade in which only the page's root takes part, and a press made during it to land;
- hurried requests to settle on the last.

A further browser test holds the chips to one row that does not scroll on both sides of the width where they close up. It reads that width from the stylesheet.

## The opened card

Activating a card opens it as a sheet in a modal dialog. [`useOpenCard`](../../../site/wall/use_open_card.ts) owns which card is open and carries every change. [`OpenCard`](../../../site/wall/OpenCard.tsx) renders the dialog only while a card is open. The sheet shows the card's glyph or numeral, its heading, its line, the optional second paragraph, and a link when the card names a manual page.

The link takes its words from the title of the page it leads to. `OpenCard` looks the page up in the `linkLabels` prop by route, without any section the address names. A label therefore cannot drift from the manual, and a link to a section carries its page's title.

The close control comes first and takes focus. A sheet too tall for a small or zoomed screen scrolls inside itself, and a browser that can focus a scrolling box would choose that box first. `OpenCard` therefore hands the control the focus outright, and the stylesheet keeps it stuck in the sheet's corner while the words scroll under it. On a narrow screen, and on a wide one with a coarse pointer, the close control and the link take a finger's 44 pixels.

`openChange` picks how a card opens or closes:

| Way   | When                                                                                                           | What the visitor sees                                                    |
| ----- | -------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------ |
| Morph | The browser has view transitions, the visitor has not asked for reduced motion, and the source card lies flat. | The card grows into the sheet, and the sheet shrinks back into the card. |
| Fade  | The same, but the source card is not flat, as in the far view.                                                 | The sheet arrives and leaves where it stands.                            |
| Cut   | The visitor asked for reduced motion, or the browser has no view transitions.                                  | The change is immediate.                                                 |

A card counts as flat when its drawn box matches its laid-out box to within a pixel. A browser with no view transitions gets a short fade from the stylesheet as the sheet opens, unless the visitor asked for reduced motion.

Only a morph marks the source card, with `data-wall-opening`. The value `morph` gives the card the sheet's view-transition name: for the picture the browser takes before the sheet grows from it, and while the sheet returns to it. The value `held` hides the card while the sheet is open, so its place on the wall stays empty and nothing reflows. At most one card carries the attribute, and none carries it after a close finishes.

### The morph

The card and the sheet share one view-transition name, so the browser grows one into the other. `wall-interactions.css` shapes what a visitor sees between them:

- **The words change in sequence.** The outgoing picture finishes its fade before the incoming one starts, on the way out and on the way back. Between them the moving box shows its own plain surface.
- **The mark crosses as an object of its own.** The card's glyph or numeral has a second view-transition name. The card's mark carries it while the card carries the shared name, and the sheet's mark carries it while a card is the sheet's source, so the name never stands on two boxes. The mark's two pictures take their scale from the box's height, because a numeral's box is as wide as its heading. The sheet sets a numeral as the card does, a size up, so the two pictures lie on each other.
- **The incoming picture's fit depends on the direction.** On the way out it fills the growing box. On the way back it is the card's picture, which is shorter for its width than the box. It keeps the box's width and its own shape there, so the browser draws no line of the card cut at the box's edge.

A receded card's mark stays in the card's picture. The browser lifts a named box out of whatever dims its card, and the mark would arrive at a dimmed card at full strength. A sheet with no source card, as in the far view, arrives and leaves whole.

### Requests, clicks, and faults

Each request states where the wall should end, so opens and closes that overlap settle in one whole state. A held key opens the sheet once.

Escape, the close control, and a click outside the sheet each close it, and focus returns to the card. The page behind keeps its scroll position and its width while the dialog is open.

While a view transition runs, the browser sends every pointer event to the document's root. Script therefore reads such a click by where it fell:

- A click outside the arriving sheet closes it from the moment the dialog mounts.
- A click inside the arriving sheet ends the transition and reaches what it fell on, from the moment the dialog mounts. The close control and the link answer while the sheet still arrives. A click on the sheet's words hands the sheet the focus, as a press on them does once the sheet rests.
- A click on the page while the sheet leaves ends the transition and reaches the link or button under it.

A double click is one act. Its later clicks land wherever the first has left the page. Under reduced motion the sheet is in place within the first click, so the second can fall on the sheet's link or its close control. `useClickSequence` in `use_open_card.ts` marks a click sequence as spent once one of its clicks has opened or closed a card, or chosen a lens. It then drops the rest of that sequence before anything on the page hears it. The press that begins a dropped click is stopped from acting too, so it takes no focus: the focus stays in the sheet the first click opened, or on the card a closed sheet handed it back to. A click that starts a sequence of its own reaches the page as usual.

`deliverClick` in `use_open_card.ts` makes a click on a visitor's behalf, for the arriving sheet, the leaving sheet, and the lens's cross-fade, and no other function does. It hands on a plain click alone: the primary button, with no modifier key held. A click made by script keeps no modifier and no button, so a link meant for a new tab would open in place. Any other click therefore ends the transition and goes nowhere, and the visitor makes it again on a page that answers for itself. The hook also listens for `auxclick`, which is how a click of another button arrives.

A view transition can fail to begin. `transitionOvertaken` sorts the browser's reason into expected and fault. It expects a hidden page, a later request that ends an earlier transition, and a viewport that changed size since the request. The page still reaches the state the request named. Anything else goes to `reportError`. An invalid state with the viewport unchanged is how the browser reports a transition name on two boxes.

A browser can also refuse a transition outright, by throwing when asked to begin one. `beginTransition` reports the refusal, and the sheet and the lens then make the change as a cut.

Opening or closing a card makes the browser restyle every element on the page once. The modal dialog costs that by itself: an empty dialog opened over the homepage restyles as much, and marking the source card restyles about a dozen elements. It happens once per change, outside the pointer-travel budget, and no test counts it.

### What holds the opened card

The interactions test holds the decisions and the stylesheet:

- `openChange`, the flatness measure, `transitionOvertaken`, and the definition of a plain click;
- a style for every state in `OPENING_STATES`;
- the two fades of the morph, which may not overlap in time in either direction;
- the incoming picture's fit for each state, from a table keyed by `OPENING_STATES`, so a new state needs a decision;
- the mark's name on one box at a time, on the sheet's own clock, with the sheet's mark set as the card's;
- the sheet's link, named by its page;
- a structural guard that no other line under `site/` makes a click, and that `deliverClick` refuses any click but a plain one before it reads the page.

The sheet test opens a card by pointer and leaves by every entry in its `WAYS_OUT` table, in the far view and in the near view. After each one, the scroll position, the plane, every card's box, and the focus must be where they began. A new way out belongs in that table. Its further cases cover:

- a double click, a press on the arriving sheet, a press while the sheet leaves, a press that is not a plain click, a held key, and overlapping requests;
- a double click whose second click lands where the sheet's link or close control rests, one on the resting sheet's close control, and one on a lens chip, with motion and under reduced motion, each leaving the focus where its first click put it;
- a browser that refuses to begin a transition, for a card and for a lens;
- a pointer's press on a wall that lies flat for the keyboard;
- the mark's crossing for each kind of card, for a receded card, and in the far view;
- a window resized between the page's change and the transition's first frame, which must raise no fault;
- print with a card open;
- finger-sized controls on a wide screen with touch;
- a sheet too tall for its screen, with the close control focused, in its corner, and in reach after the sheet scrolls.

Under reduced motion, the browser test opens every card in the deck by keyboard. It checks each sheet's name, and compares each link's name with the manual's titles.

## Forced colors, more contrast, and print

Forced colors get flat cards in system colors and no light. The lens bar takes a solid system-color backing with a rule along its foot, so no chip sits on a card's words. The card test holds the cards' part, and the light test emulates forced colors in a browser for the room's.

A visitor who asks for more contrast gets the room's quieter inks nearer to its full ink. The chips, the divider, and the close control get firmer edges, and receded cards come nearer to full strength. The browser test holds the inks, a chip's edge, the divider, and the receded card, which must still read as set aside.

On paper the room is a plain light sheet with no bar, no link past the cards, no grain, no light, and no dark margin. Receded cards print at full strength. With a card open, paper still gets the wall. The sheet and its backdrop stay off the page, the card it grew from shows in its own place, and the page prints at its full width and length. The card test holds the cards' part, the light test emulates print for the room's, and the sheet test prints with a card open.

## Guards

- [`tests/site_wall_island_test.ts`](../../../tests/site_wall_island_test.ts) holds the island boundary. Only `island.tsx` imports `react-dom/client`, and no module imports the island. The served wall equals the component's render. The island reads back the props the server wrote, link labels included, and each label is the title of the page it names. The built bundle is fresh and named by its digest. `wallIslandFile` refuses a bundle that is not the island, and no other module under `site/` spells the island's name. A file gets the immutable cache policy when its name carries the digest of its bytes, and no other file gets it. The island loads on `/`, and no other live route loads a script that contains a React runtime. The test finds a runtime by script content, through imports, under any file name. The same file holds [the custom-property and attribute contract](#knobs-and-the-tuning-panel) in both directions and [the far-view rules](#keyboard-focus-and-the-far-view).
- [`tests/site_design_system_runtime_test.ts`](../../../tests/site_design_system_runtime_test.ts) keeps the island out of the production server's module graph and applies the same content check to every bundle route. It takes the check, `carriesReactRuntime`, from `assets.ts`, where the build uses it too.
- [`tests/site_homepage_browser_test.ts`](../../../tests/site_homepage_browser_test.ts) loads the page in a real browser at phone and laptop sizes, under the production Content Security Policy. Its cases cover the page without script, hydration with the stage and the lens, hydration under development React, reduced motion, the keyboard's walk, narrow and zoomed rooms, the chip row, more contrast, touch, and the tuning panel. Every case fails on a page error, a console error or warning, a failed request, or an error response.
- [`tests/site_wall_sheet_browser_test.ts`](../../../tests/site_wall_sheet_browser_test.ts) holds [the opened card](#the-opened-card) in a real browser, with the same fault capture: every way out, hurried input, a refused transition, the mark's crossing, a resize, print, touch sizes, and a short screen. It also holds a pointer's press on [a wall the keyboard has laid flat](#keyboard-focus-and-the-far-view).
- [`tests/site_wall_card_test.ts`](../../../tests/site_wall_card_test.ts) holds [a card's](#cards) markup, type, surfaces, and states, and the rule that no wall stylesheet blurs a backdrop or fixes a background to the viewport.
- [`tests/site_wall_interactions_test.ts`](../../../tests/site_wall_interactions_test.ts) holds [the lens](#the-lens-and-receded-cards), the receded card's contrast, and [how a card opens](#the-opened-card).
- [`tests/site_wall_light_test.ts`](../../../tests/site_wall_light_test.ts) holds [the pointer light](#the-pointer-light): its arithmetic, the non-inheriting properties, the restyle budget for pointer travel and for the keyboard, the trace of forced layout, the moved wall, the selection colors, and the forced-colors and print fallbacks.
- [`tests/site_wall_deck_test.ts`](../../../tests/site_wall_deck_test.ts) resolves every citation and holds [the copy rules](#the-deck). It ties each numeral to its inventory, requires the wall and every lens to open on the lead, and requires neighbors on the wall to span several clusters.
- [`tests/site_wall_glyph_test.ts`](../../../tests/site_wall_glyph_test.ts) holds [the glyphs](#glyphs): the vocabulary, the triangle budget, exact arithmetic, the two drawings, the pose and its ease, the paint order, the dashed stroke, and the evenness of the set. [`tests/site_wall_glyph_motion_test.ts`](../../../tests/site_wall_glyph_motion_test.ts) holds the move's cost in a real browser.
- [`tests/site_prose_test.ts`](../../../tests/site_prose_test.ts) requires the homepage's prose projection to hold every card's second paragraph and the words each lens shows.
- [`tests/site_ui_test.ts`](../../../tests/site_ui_test.ts) applies the shared component boundary to `site/wall`: no `dangerouslySetInnerHTML`, and no design-system class name written by hand.
- [`tests/site_accessibility_test.ts`](../../../tests/site_accessibility_test.ts) and [`tests/site_homepage_scaffold_test.ts`](../../../tests/site_homepage_scaffold_test.ts) audit the homepage's landmarks, its manual link, and its accessibility findings.

Helper modules serve these tests, and a new wall test starts from them:

- [`tests/wall_stylesheets.ts`](../../../tests/wall_stylesheets.ts) reads the wall's stylesheets for every test. Its parser keeps each rule's at-rule context and splits a selector list or a value only outside brackets. Every test that holds a stylesheet to a rule reads it through that parser, so they agree on what a rule is. The module also owns `MOTION_PROPERTY`, the shared expression for a property that moves a box or times a change.
- [`tests/site_wall_browser.ts`](../../../tests/site_wall_browser.ts) holds what the real-browser tests share: the production handler behind a page that records every fault, the viewports, and the selectors for the near and far wall, which it builds from the exported attribute names. Its `motionSettled` waits only for finite animations on the document's own timeline. The lens bar's scroll-driven animations never end, so a wait for every animation would never return.
