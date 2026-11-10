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

The homepage body is one wall of small cards between the shared site header and footer. Each card states one thing discern does. A visitor scans the cards in any order, narrows them with a lens, and opens a card for a second paragraph and a link into the manual.

The wall is the site's only hydrated React island ([ADR 0430](../_adr/0430-the-homepage-ships-one-hydrated-react-island.md)). The server renders the complete page, and the browser then hydrates the wall so its controls respond. No other route sends a framework runtime to the browser.

## Where each concern lives

Components, hooks, and data live in [`site/wall/`](../../../site/wall/). Stylesheets live in `site/page-src/`.

| Concern                                        | Source                                                                                                                                                                                                         | Guard                                                                                                                                                              |
| ---------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Document shell and island host                 | [`HomePage.tsx`](../../../site/ui/pages/HomePage.tsx)                                                                                                                                                          | [`site_wall_island_test.ts`](../../../tests/site_wall_island_test.ts)                                                                                              |
| Page body and root state                       | [`WallPage.tsx`](../../../site/wall/WallPage.tsx)                                                                                                                                                              | [`site_homepage_browser_test.ts`](../../../tests/site_homepage_browser_test.ts)                                                                                    |
| Seam between server render and island          | [`host.ts`](../../../site/wall/host.ts), [`island.tsx`](../../../site/wall/island.tsx)                                                                                                                         | [`site_wall_island_test.ts`](../../../tests/site_wall_island_test.ts)                                                                                              |
| Built assets and the island's file name        | [`assets.ts`](../../../site/wall/assets.ts), [`site/build.ts`](../../../site/build.ts)                                                                                                                         | [`site_wall_island_test.ts`](../../../tests/site_wall_island_test.ts), [`site_design_system_runtime_test.ts`](../../../tests/site_design_system_runtime_test.ts)   |
| Data contract, cards, lenses, cluster hues     | [`types.ts`](../../../site/wall/types.ts), [`deck.ts`](../../../site/wall/deck.ts), [`clusters.ts`](../../../site/wall/clusters.ts)                                                                            | [`site_wall_deck_test.ts`](../../../tests/site_wall_deck_test.ts)                                                                                                  |
| A card's markup, surfaces, and states          | [`Card.tsx`](../../../site/wall/Card.tsx), [`wall-card.css`](../../../site/page-src/wall-card.css)                                                                                                             | [`site_wall_card_test.ts`](../../../tests/site_wall_card_test.ts)                                                                                                  |
| The lens and receded cards                     | [`Lens.tsx`](../../../site/wall/Lens.tsx), [`wall-interactions.css`](../../../site/page-src/wall-interactions.css)                                                                                             | [`site_wall_interactions_test.ts`](../../../tests/site_wall_interactions_test.ts), [`site_homepage_browser_test.ts`](../../../tests/site_homepage_browser_test.ts) |
| The opened card                                | [`OpenCard.tsx`](../../../site/wall/OpenCard.tsx), [`use_open_card.ts`](../../../site/wall/use_open_card.ts), [`wall-interactions.css`](../../../site/page-src/wall-interactions.css)                          | [`site_wall_interactions_test.ts`](../../../tests/site_wall_interactions_test.ts), [`site_homepage_browser_test.ts`](../../../tests/site_homepage_browser_test.ts) |
| Glyph vocabulary, drawings, renderer, and pose | [`glyph_grammar.ts`](../../../site/wall/glyph_grammar.ts), [`glyphs.ts`](../../../site/wall/glyphs.ts), [`Glyph.tsx`](../../../site/wall/Glyph.tsx), [`wall-glyph.css`](../../../site/page-src/wall-glyph.css) | [`site_wall_glyph_test.ts`](../../../tests/site_wall_glyph_test.ts)                                                                                                |
| Pointer light                                  | [`use_light.ts`](../../../site/wall/use_light.ts), [`wall.css`](../../../site/page-src/wall.css), [`wall-card.css`](../../../site/page-src/wall-card.css)                                                      | [`site_wall_light_test.ts`](../../../tests/site_wall_light_test.ts)                                                                                                |
| The stage and the approach                     | [`use_stage.ts`](../../../site/wall/use_stage.ts), [`wall.css`](../../../site/page-src/wall.css)                                                                                                               | [`site_homepage_browser_test.ts`](../../../tests/site_homepage_browser_test.ts)                                                                                    |
| Tunable values and the tuning panel            | [`tuning/knobs.ts`](../../../site/wall/tuning/knobs.ts), [`tuning/Panel.tsx`](../../../site/wall/tuning/Panel.tsx)                                                                                             | [`site_wall_island_test.ts`](../../../tests/site_wall_island_test.ts), [`site_homepage_browser_test.ts`](../../../tests/site_homepage_browser_test.ts)             |

`WALL_STYLESHEETS` in `assets.ts` lists the wall's stylesheets in cascade order, and the build copies each one beside the homepage's design-system bundle:

| Stylesheet                                                              | Styles                                                                                                                                             |
| ----------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------- |
| [`wall.css`](../../../site/page-src/wall.css)                           | The room, the headline pool, the stage and its approach, the lens bar's place, the light on the canvas, and the forced-colors and print fallbacks. |
| [`wall-card.css`](../../../site/page-src/wall-card.css)                 | Card surfaces, the light on card borders, and the rest, hover, focus, and pressed states.                                                          |
| [`wall-glyph.css`](../../../site/page-src/wall-glyph.css)               | Glyph tones, strokes, and the pose a lit card's glyph holds.                                                                                       |
| [`wall-interactions.css`](../../../site/page-src/wall-interactions.css) | Lens chips, receded cards, the opened card, and its transitions.                                                                                   |
| [`wall-tuning.css`](../../../site/page-src/wall-tuning.css)             | The tuning panel.                                                                                                                                  |

Each kind of movement has one element. Hover transforms belong to `.wall-card-face`. The scroll approach transforms `.wall-plane`. The list item `.wall-card` changes only opacity and filter. Keeping them apart stops a transform in one stylesheet from replacing a transform in another. The card test fails when `wall-card.css` moves or fades the list item, and the interactions test fails when `wall-interactions.css` moves it.

## Server render and hydration

[`renderLanding`](../../../site/ui/pages/HomePage.tsx) renders `WallPage` to markup inside the host element `#wall-island` and writes the props it used to that element's `data-wall-props` attribute. The island reads them back through `decodeWallProps`, which refuses a malformed value, and hydrates the host with the same component. The props are plain text: the mark, the version, the headline, and the category line. The deck, lenses, and knob table are modules the component imports on both sides.

Hydration has nothing to reconcile only while both renders produce the same markup. These rules keep them equal:

- `WallPage` and everything under it read no clock, no randomness, and nothing from the browser before an effect runs.
- No component calls `useId`. An element id is a fixed string or derives from a card id.
- The site build formats every generated page, and reformatting the wall's markup would change the nodes React expects. `HomePage.tsx` places a formatter directive before the host so the formatter leaves that element alone.

The island test proves the result: the served homepage contains the bytes that `renderToString` produces from the props on the host.

The page works before script runs. Every card's text, the headline, and the call to action are server markup. The lens bar needs script, so it stays hidden until the island sets `data-wall-live`. A card's heading is a button in server markup. Until the island is live, that button opens nothing and shows no pointer cursor, though the keyboard still stops on it. The opened card and the tuning panel never appear in server markup. `OpenCard` renders nothing until a card is open, and the wall checks the address for the panel's parameter only after it mounts.

The browser test loads the page with script off at phone and laptop sizes. It requires every card's copy to show, nothing left hidden or faded once the wall is flat, and no visible button that invites a press.

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

## Cards

[`Card.tsx`](../../../site/wall/Card.tsx) renders each card as one list item, `li.wall-card`. The item carries its kind as a modifier class and its cluster hue as `--wall-hue`. Inside it, `div.wall-card-face` holds an empty box for the [pointer light](#the-pointer-light), the glyph on a benefit card, the heading, and the line. The heading holds the card's one button, which the stylesheet stretches over the face. A numeral card's number sits inside that button, so assistive technology reads the number once, as part of the heading.

A card is lit while its button has keyboard focus or a pointer that can hover is over it. A lit card's face lifts slightly, its border takes the card's hue, and its glyph holds its pose. Under a pointer the face also leans toward it, by the `hover-tilt` knob's angle at most. `Card.tsx` writes the pointer's place inside the hovered card to `--wall-pointer-x` and `--wall-pointer-y` on the list item. It measures the card once as the pointer enters, and each move after that is arithmetic.

[`site_wall_card_test.ts`](../../../tests/site_wall_card_test.ts) holds the card's rules:

- Every card in the deck renders its kind's markup, and assistive technology reads each card's words once, in reading order.
- Hover rules apply only where a pointer can hover, so a tap leaves no card lit.
- The tilt stays within the knob's angle, and the lift within the test's pixel bound.
- The browser draws a face that moves or lights over the other cards until it rests. A moving layer in the middle of the wall would make the browser redraw every later card.
- Every outer shadow takes its size from the gap between cards, so no shadow reaches a neighbor.
- The wall sets sans-serif type only.
- Print and forced colors get flat cards in system colors.

## Glyphs

A glyph is data: a list of primitives on a 48-unit grid, each painted in one of the tones `glyph_grammar.ts` defines. [`Glyph.tsx`](../../../site/wall/Glyph.tsx) draws every glyph, so the set shares one grid, stroke, and weight. [`glyphs.ts`](../../../site/wall/glyphs.ts) authors one drawing per benefit card, keyed by card id. `glyphDrawing` returns the authored drawing for a name, or a seeded drawing computed from the name alone, so no card is ever blank and both renders agree.

Server and browser must serialize a glyph to the same markup. `Math.sin`, `Math.cos`, and `Math.sqrt` can differ in their last bit between engines. The grammar therefore computes angles and lengths with arithmetic the language defines to the last bit, and it rounds every coordinate before it leaves the module. A structural guard in the glyph test rejects anything in the glyph modules that could vary between renders.

The split triangle of the discern mark is a rare accent. The glyph test counts every triangle form and permits at most one glyph in eight to draw one. The recursive triangle stays reserved, as the visual identity requires.

A drawing may mark one primitive to shift a few units. The renderer hands that distance to the stylesheet as `--wall-glyph-dx` and `--wall-glyph-dy`, and the primitive holds the shifted pose while its card is lit. Where a pointer can hover, the pose carries through the opening. The source card keeps the pose while the hook marks it, and the opened card draws its own glyph in the same pose. The glyph test reads the lit states from `wall-card.css`, so a change to how a card lights fails that test until `wall-glyph.css` follows. The test also fails when another module under `site/wall/` starts to draw a glyph, until someone decides its pose.

A dashed stroke gives up part of its length to gaps. The renderer marks a dashed shape with a second class, and the stylesheet draws it heavier than a whole stroke so that it reads at card size. The glyph test requires a dashed stroke to keep most of a whole stroke's ink and to keep its gaps open at the heaviest weight the knob reaches.

`wall-glyph.css` paints every tone from `currentColor`, and the glyph test fails when the renderer emits a class the stylesheet does not style. The same test keeps the set even:

- A card in the deck draws every authored key.
- Each glyph carries a like share of ink and fills its grid.
- No two glyphs share a silhouette.
- No single device, such as an enclosing frame or a stack of rows, carries a family of glyphs.

The limits are constants in the test. A seeded glyph meets the ink and grid limits too.

## Knobs and the tuning panel

[`WALL_KNOBS`](../../../site/wall/tuning/knobs.ts) is the single table of tunable values: each knob's name, label, unit, range, step, and default. The server writes every default as a `--wall-<name>` custom property in the wall root's inline style. The stylesheets read those properties with no fallback value, so a stylesheet cannot carry a second default. A hook that needs a knob reads the same inline property from the root.

The island test enforces the contract. Every `var(--wall-*)` in a wall stylesheet must name a knob, a property a wall stylesheet declares, or a property a `site/wall` source writes. A `var()` with a fallback fails.

Add a knob by adding one entry to the table and reading its property in a stylesheet or a source file. The panel lists whatever the table holds.

The tuning panel is a development aid. It appears only when the address carries a `tune` query parameter, as in `/?tune`, and only after the island has mounted. It shows one range control per knob, copies the current values as JSON, and resets them to the defaults. The panel edits the same inline properties the server wrote, so a change shows in place. The site carries its own panel because the Content Security Policy refuses the run-time styles that third-party panels inject.

## Motion contract

Calm motion is a requirement of the page. These rules bind every stylesheet and hook on the wall, and each names the test that fails on a breach:

- **Pointer travel moves nothing.** The light changes brightness and never geometry. The browser test sweeps a pointer across the flat wall. A card the pointer has not touched must keep its box, opacity, and filter at every stop, and every card must return to rest afterward.
- **Hover changes only the hovered card.** Its face may travel a short distance. The same sweep bounds that travel, and the card test bounds the tilt, the lift, and the shadows.
- **Scroll moves the wall as one plane.** The approach transforms `.wall-plane` and nothing inside it. The browser test finds the plane tilted at the top of a laptop page, free of any transform once the wall is near, and tilted again after scrolling back. The page keeps its width and height throughout.
- **A lens changes opacity and saturation only.** The interactions test rejects any property that would move or resize a receded card. The browser test compares every card's place before and after each lens.
- **Opening a card moves one object.** The card grows into the sheet only from a flat card. The interactions test holds that choice, and the browser test requires the page to return to rest after every way out.
- **A glyph moves one primitive, by a few units, on a lit card.** The glyph test bounds the shift and ties the pose to the card's lit states.
- **Phones and reduced motion get the flat wall from the start.** The browser test checks a phone at load, and reduced motion both at load and when the preference changes under a loaded page.
- **Reduced motion stills the rest.** The card test and the glyph test require every transform and transition in their stylesheets to sit inside a `prefers-reduced-motion: no-preference` block. The interactions test requires a card to open with a cut, and the light test requires the light to appear and go with no fade. Under reduced motion, the browser test requires the lens bar to arrive with no transition of its own, and it opens every card in the deck.
- **A finger moves nothing.** The browser test draws a finger across the wall and fails when any attribute inside the wall changes.
- **Movement is cheap to draw.** Cards animate `transform` and `opacity`, and the list item fades through `opacity` and `filter`. The card test rejects `backdrop-filter` and any background fixed to the viewport, in every wall stylesheet. The light test bounds what a frame of pointer travel restyles.
- **Nothing keeps moving by itself at the shipped defaults.** The wall fades in once. Ambient drift is a knob whose default is zero, and while drift is on, the wall shows a pause control. The browser test asserts the default, the absent control, and that the control pauses the drift.

Some parts of the contract have no test, and [`project/TODO.md`](../../TODO.md) carries each:

- No test runs a browser that lacks scroll-driven animation, which gets the flat wall too.
- No test counts layout reads in the wall's pointer and scroll handlers.
- No test scrolls the page under a still pointer to see the light follow.

### The approach

The approach itself is CSS. Where the browser supports scroll-driven animation, [`wall.css`](../../../site/page-src/wall.css) ties the plane's tilt and distance to scroll. The headline pool leaving the viewport times it, so the wall is flat when its top reaches the top of the viewport. No script measures or moves anything while the page scrolls. The stylesheet stages the approach only on a large screen with a fine pointer that can hover, and only for a visitor with no reduced-motion or forced-colors preference. The page is complete without script in either state.

[`use_stage.ts`](../../../site/wall/use_stage.ts) defines a stage as an id and a `mount` function that takes the wall root and returns the function that restores it. `useStage` runs one stage and marks the root with its id. The approach is the only stage, and the interface exists so another can replace it.

The stage sets `data-wall-near` whenever the plane is flat and carries no transform. The far-view rules in `wall.css` stand down under that attribute, and the light reaches card borders only under it.

The stage starts one movement. A card the keyboard steps onto in the far view is too small to read, so the stage scrolls the wall near. It answers the release of the Tab key. A focus event alone scrolls nothing, so focus that a closing sheet, a script, or a returning window hands to a far card leaves the page still. The browser test covers both: Tab onto a far card brings the wall near, and focus handed to a far card leaves the page where it was.

## The pointer light

One light follows a mouse or pen across the wall. [`useLight`](../../../site/wall/use_light.ts) writes its place and its brightness, at most once per frame. The stylesheets draw it on the canvas and on card borders:

- **On the canvas.** `.wall::before` is one soft disc under everything in the room. The hook writes the light's place, measured from the wall root's corner, to `--wall-light-x` and `--wall-light-y` on the root. It writes how far the light has come up to `--wall-light-on`. The disc follows through `translate` and fades through `opacity`.
- **On card borders.** Each card's face holds an empty box, `span.wall-card-light`, masked down to the one-pixel border ring. For each card within reach of the light, the hook writes the light's place from that card's own corner to `--wall-card-light-x` and `--wall-card-light-y` on that box, with `--wall-card-light-on` beside them. It removes all three when the card falls out of reach.

The stylesheet decides the reach. `--wall-light-reach` on the root is zero at rest. It equals the light's throw only under `.wall[data-wall-near]`, on a screen with a pointer that can hover. So no card takes the light while the plane tilts away, or on a touch screen. The hook reads the computed reach each frame, because the wall can arrive or leave under a still pointer. The card test requires the reach and the box's own gradient to name the same throw.

### What a frame costs

A custom property inherits unless a stylesheet registers it otherwise. An inheriting property written on the root every frame makes the browser restyle every element in the wall every frame. The stylesheets therefore register each property that script writes during pointer travel with `@property` and `inherits: false`. A box takes one only by declaring `<name>: inherit`, and only a box that draws with the value may ask.

A browser that restyles an element also looks again at that element's children. The border light therefore lives on an empty box. On the face, the same value would cost the glyph, the heading, and the line a second look each frame.

A frame of pointer travel restyles the root with its pseudo-elements and its three sections, and one empty box in each card near the pointer. The card under the pointer restyles its own face as well, and a card restyles whole once as the pointer enters or leaves it. None of those counts grows with the deck.

Selected text costs too. The browser works out an element's `::selection` style each time it restyles that element, and a highlight rule that reads a design-system token is slow to work out. `wall.css` names the room's selection colors itself and reads no token. Selected words keep their own color on a blue wash, which stays readable in both site themes.

The hook measures no box in a pointer or scroll handler. It measures the root and each card's box when a `ResizeObserver` reports a change, and every frame after that is arithmetic. A card's box comes from layout offsets, which ignore transforms, so a lifted face reads the same as one at rest.

### How the light comes and goes

- The light comes up where the pointer is and goes down where it stands, over the `light-fade` knob's milliseconds. It never sweeps in from an edge.
- While up, it eases toward the pointer over the `light-ease` knob's milliseconds and stops writing once it arrives. A still pointer costs nothing.
- A pointer that jumps farther than the light's own size draws no light across the wall. The light goes dark in place and comes up at the pointer.
- A page that scrolls under a still pointer moves the pointer's place on the wall, and the light follows the same way.
- Reduced motion removes the fade. Touch never moves the light, and it holds still while the pointer is over an opened card.
- Forced colors and print draw neither the disc nor the boxes.

[`site_wall_light_test.ts`](../../../tests/site_wall_light_test.ts) holds the light through plain, stylesheet, and browser tests:

- Plain tests check the arithmetic of `lightFrame` and `lightGap`. The interactions test checks `lightStep`, the easing step that `lightFrame` takes.
- Stylesheet tests take the list of frame-written properties from `LIGHT_PROPERTIES` in `use_light.ts` and `POINTER_PROPERTIES` in `Card.tsx`, so a new property enrolls itself. Each must register as non-inheriting. No state of the wall root may change an inheriting property. No highlight rule in a wall stylesheet may read a `--discern-` token.
- Browser tests trace a pointer sweep and fail when one style recalculation touches more elements than the test's budget. They run on the wall as built and on a wall with every card cloned, and they hold the wall's arrival and departure to the same budget.
- Further browser tests watch the light come up, jump, and go down. They require no write at rest or over an opened card, and none from a finger.

## The lens and receded cards

The lens bar sits at the top of the wall and stays pinned as the reader scrolls. [`Lens.tsx`](../../../site/wall/Lens.tsx) renders "Everything" and one chip per `WALL_LENSES` entry. Each chip is a toggle with `aria-pressed`, and pressing the active chip lets the lens go. A lens chip carries one dot per cluster it gathers, in that cluster's hue. Where the chips do not fit one row, they form a strip that scrolls sideways, and a chosen or keyboard-focused chip moves to its middle.

A card outside the active lens recedes. It carries `data-receded`, and `wall-interactions.css` lowers its opacity and removes nearly all its color. The card keeps its place and stays in the list, where a visitor can still read, focus, and open it. Pointing at a receded card, or reaching it by keyboard, brings that one card back up.

The opacity has a floor. A receded card's title and line must both keep a contrast of at least 4.5 to 1. The interactions test computes that contrast from the stylesheets' own colors. The loss of color is what makes the card read as receded.

After a visitor chooses a lens, the page scrolls once to the nearest card the lens kept forward, unless one is at least half in view. On a narrow screen, a whole viewport can otherwise hold only receded cards. Reduced motion gets the same place without the travel. `lensTravel` computes the distance.

The interactions test checks which cards each lens recedes, the scroll distance, and the chips' pressed states. The browser test presses every lens at phone and laptop sizes. It requires one row of chips, no sideways page overflow, the right cards receded, no card moved or removed, and a kept card in view.

## The opened card

Activating a card opens it as a sheet in a modal dialog. [`useOpenCard`](../../../site/wall/use_open_card.ts) owns which card is open and carries every change. [`OpenCard`](../../../site/wall/OpenCard.tsx) renders the dialog only while a card is open. The sheet shows the card's glyph or numeral, its heading, its line, the optional second paragraph, and a docs link when the card names a page. The close control comes first and takes focus.

`openChange` picks how a card opens or closes:

| Way   | When                                                                                                           | What the visitor sees                                                    |
| ----- | -------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------ |
| Morph | The browser has view transitions, the visitor has not asked for reduced motion, and the source card lies flat. | The card grows into the sheet, and the sheet shrinks back into the card. |
| Fade  | The same, but the source card is not flat, as in the far view.                                                 | The sheet arrives and leaves where it stands.                            |
| Cut   | The visitor asked for reduced motion, or the browser has no view transitions.                                  | The change is immediate.                                                 |

A card counts as flat when its drawn box matches its laid-out box to within a pixel. A browser with no view transitions gets a short fade from the stylesheet as the sheet opens, unless the visitor asked for reduced motion.

Only a morph marks the source card, with `data-wall-opening`. The value `morph` gives the card the sheet's view-transition name for the length of the transition. The value `held` hides the card while the sheet is open, so its place on the wall stays empty and nothing reflows. At most one card carries the attribute, and none carries it after a close finishes. The sheet's words replace the card's in sequence: the outgoing words disappear before the incoming words show.

Each request states where the wall should end, so opens and closes that overlap settle in one whole state. A held key opens the sheet once.

Escape, the close control, and a click outside the sheet each close it, and focus returns to the card. The page behind keeps its scroll position and its width while the dialog is open.

While a view transition runs, the browser sends every pointer event to the document's root. Script therefore reads such a click by where it fell:

- A click outside the arriving sheet closes it from the moment the dialog mounts.
- A click on the page while the sheet leaves ends the transition and reaches the link or button under it.
- Both places ignore the later clicks of a double click, so a double click on a card opens it once.

The interactions test holds `openChange` and the flatness measure, and requires the stylesheet to style every state in `OPENING_STATES`. It also reads the two fades of the morph from the stylesheet and fails when they overlap in time. The browser test opens a card by pointer and leaves by every entry in its `WAYS_OUT` table, in the far view and in the near view. After each one, the scroll position, the plane, every card's box, and the focus must be where they began. A new way out belongs in that table. Further cases cover a double click, a press while the sheet leaves, a held key, and overlapping requests.

## Forced colors and print

Forced colors get flat cards in system colors and no light. The lens bar takes a solid system-color backing with a rule along its foot, so no chip sits on a card's words. On paper the room is a plain light sheet with no bar, no grain, no light, and no dark margin. The card test holds the cards' part, and the light test emulates both modes in a browser for the room's.

## Guards

- [`tests/site_wall_island_test.ts`](../../../tests/site_wall_island_test.ts) holds the island boundary. Only `island.tsx` imports `react-dom/client`, and no module imports the island. The served wall equals the component's render. The built bundle is fresh and named by its digest. The island loads on `/`, and no other live route loads a script that contains a React runtime. The test finds a runtime by script content, through imports, under any file name.
- [`tests/site_design_system_runtime_test.ts`](../../../tests/site_design_system_runtime_test.ts) keeps the island out of the production server's module graph and applies the same content check to every bundle route.
- [`tests/site_homepage_browser_test.ts`](../../../tests/site_homepage_browser_test.ts) loads the page in a real browser at phone and laptop sizes, under the production Content Security Policy. Its cases cover the page without script, hydration with the stage and the lens, every way out of the opened card, hurried input, reduced motion, touch, and the tuning panel. Every case fails on a page error, a console error or warning, a failed request, or an error response.
- [`tests/site_wall_card_test.ts`](../../../tests/site_wall_card_test.ts) holds [a card's](#cards) markup, type, surfaces, and states, and the rule that no wall stylesheet blurs a backdrop or fixes a background to the viewport.
- [`tests/site_wall_interactions_test.ts`](../../../tests/site_wall_interactions_test.ts) holds [the lens](#the-lens-and-receded-cards), the receded card's contrast, and [how a card opens](#the-opened-card).
- [`tests/site_wall_light_test.ts`](../../../tests/site_wall_light_test.ts) holds [the pointer light](#the-pointer-light): its arithmetic, the non-inheriting properties, the restyle budget, the selection colors, and the forced-colors and print fallbacks.
- [`tests/site_wall_deck_test.ts`](../../../tests/site_wall_deck_test.ts) resolves every citation, holds copy to the wall's length limits, checks that every card link leads to a manual page, ties each numeral to its inventory, and requires neighbors on the wall to span several clusters.
- [`tests/site_wall_glyph_test.ts`](../../../tests/site_wall_glyph_test.ts) holds [the glyphs](#glyphs): the vocabulary, the triangle budget, exact arithmetic, the pose, the dashed stroke, and the evenness of the set.
- [`tests/site_ui_test.ts`](../../../tests/site_ui_test.ts) applies the shared component boundary to `site/wall`: no `dangerouslySetInnerHTML`, and no design-system class name written by hand.
- [`tests/site_accessibility_test.ts`](../../../tests/site_accessibility_test.ts) and [`tests/site_homepage_scaffold_test.ts`](../../../tests/site_homepage_scaffold_test.ts) audit the homepage's landmarks, its manual link, and its accessibility findings.
