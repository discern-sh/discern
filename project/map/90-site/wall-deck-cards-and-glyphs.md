---
aliases:
  - wall deck
  - wall cards
  - wall glyphs
---

# The wall's deck, cards, and glyphs

What [the homepage wall](the-homepage-wall.md) shows: the deck of cards and lenses, a card's markup and states, and the glyph a card carries. That page names the files and tests this page refers to.

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

A card also names the feature nodes it `drawsOn`: the nodes of the [feature canon](../_internal/feature-canon.md) that its own words depend on ([ADR 0431](../_adr/0431-wall-cards-name-the-feature-nodes-they-draw-on.md)). It chooses them from the nodes its cited entry rests on. A benefit rests on the nodes it draws on, and an agent benefit also on the nodes that support it. A consequence rests on the nodes of the human benefits under it, and a claim on the nodes of every benefit that carries it. The deck test fails when a card draws on a node the feature canon no longer holds, or on one its entry does not rest on. Removing a feature therefore stops at every card that describes it.

`deck.ts` holds ids and words only, because the homepage's browser bundle loads it. [`scripts/brand/wall.ts`](../../../scripts/brand/wall.ts) reads those ids against the registries. Its `wallCitables` says what a card may cite and which nodes each entry rests on, for the deck test and the generated page alike. [`scripts/brand/docs/wall.ts`](../../../scripts/brand/docs/wall.ts) renders [the homepage wall page](../_internal/brand/homepage-wall.md) from it: every card beside the entry it expresses and the nodes it draws on, then an index from each feature node to its cards. Review a change to the deck there.

A human-benefit card takes the benefit's registry id as its own id. `CLUSTER_IDS` in `types.ts` names the Human Benefit Canon's clusters in that canon's order, and the deck test holds the two lists equal. `WALL_ABSENT` names any human benefit the wall omits and gives the reason. The deck test fails when a human benefit is neither a card nor listed there.

A numeral card states a count as fact, so the count comes from its inventory. The agent names come from [`agent_catalogue.ts`](../../../src/shared/agent_catalogue.ts) when the page renders. The count of discern's own quality limits is a constant, because `deck.ts` also runs in the browser, where it cannot read `discern.toml`. The deck test holds that constant equal to the file. On the published site, `src/` comes from the released product ([Publish a website update](publishing.md#publish-a-website-update)), so the wall names the agents that release supports and shows its version.

`WALL_LENSES` gives each lens a label and the clusters it gathers. Between them the lenses cover every cluster, and the deck test fails on a cluster no lens gathers. A lens sets aside the cards outside its clusters and removes none. `clusters.ts` gives each cluster one hue, which a card passes to the stylesheets as `--wall-hue`.

Card fronts are server markup, so the [public-site prose checks](design-system-consumption.md#public-site-prose) and the reading-grade standard read them. Some words reach the page only through script: an opened card's second paragraph, the divider a lens draws, and the lens's status sentence. `SCRIPT_SHOWN_PROSE` in [`scripts/site_prose_lib.ts`](../../../scripts/site_prose_lib.ts) adds them to the homepage's projection, so the same checks read those too. It takes each card's second paragraph from the deck, the divider's words from `LENS_REST`, and one sentence per lens from `lensStatus`. [`tests/site_prose_test.ts`](../../../tests/site_prose_test.ts) fails when the projection lacks any of them. The do-not-claim guard reads `deck.ts` as source. [`scripts/canonical_sets.ts`](../../../scripts/canonical_sets.ts) declares the cards, the lenses, and the [tuning knobs](wall-motion.md#knobs-and-the-tuning-panel) as canonical sets, so the [registry atlas](../_internal/registry-atlas.md) names the tests that hold each one.

The deck test holds the copy to these rules:

- Titles, lines, statements, and second paragraphs stay inside the length limits the test names as constants.
- A numeral card's title never says its number again, as a figure or as a word. The heading reads as the numeral and then the title.
- A span of minutes on a card is one the manual's setup page states.
- Every link leads to a page the manual publishes, and a link to a section names a heading on that page.

## Cards

[`Card.tsx`](../../../site/wall/Card.tsx) renders each card as one list item, `li.wall-card`. The item carries its kind as a modifier class and its cluster hue as `--wall-hue`. Inside it, `div.wall-card-face` holds an empty box for the [pointer light](wall-pointer-light.md), the glyph on a benefit card, the heading, and the line. The heading holds the card's one button, which the stylesheet stretches over the face. A numeral card's number sits inside that button, so assistive technology reads the number once, as part of the heading.

A card is lit while its button has keyboard focus or a pointer that can hover is over it. A lit card's face lifts slightly, its border takes the card's hue, and its glyph holds its pose. Under a pointer the face also leans toward it, by the `hover-tilt` knob's angle at most. `Card.tsx` writes the pointer's place inside the hovered card to `--wall-pointer-x` and `--wall-pointer-y` on the list item. It measures the card once as the pointer enters, and each move after that is arithmetic on that box until the pointer leaves.

Where the list is one column, a benefit card sets its glyph beside its words, which shortens a phone's page. The width `wall-card.css` names for that layout is the widest viewport at which the list has one column.

The browser scrolls to a focused card's button, which is the heading's box alone. The button therefore carries two scroll margins. The first brings the card to rest clear of the pinned lens bar. The second is as tall as the tallest foot a card has under its heading, so the card's foot comes into view too.

[`site_wall_card_test.ts`](../../../tests/site_wall_card_test.ts) holds the card's rules:

- Every card in the deck renders its kind's markup, and assistive technology reads each card's words once, in reading order.
- Hover rules apply only where a pointer can hover, so a tap leaves no card lit.
- The wall sets sans-serif type only.
- Print and forced colors get flat cards in system colors.

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

Where a pointer can hover, the pose carries through the opening. The source card keeps the pose while the hook marks it, and the opened card draws its own glyph in the same pose. [A marked card holds still](wall-opened-card.md#what-a-transition-costs), so its glyph takes the pose at once, and eases back to rest when the mark goes.

The glyph test holds the two drawings in the markup.

### The set

A dashed stroke gives up part of its length to gaps. The renderer marks a dashed shape with a second class, and the stylesheet draws it heavier than a whole stroke so that it reads at card size.

`wall-glyph.css` paints every tone from `currentColor`, and the glyph test fails when the renderer emits a class the stylesheet does not style. The same test requires a card in the deck to draw every authored key.
