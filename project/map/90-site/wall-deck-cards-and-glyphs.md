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

[`Card.tsx`](../../../site/wall/Card.tsx) renders each card as one list item, `li.wall-card`. The item carries its kind as a modifier class and its cluster hue as `--wall-hue`. Inside it, `div.wall-card-face` holds an empty box for the [pointer light](wall-pointer-light.md), the glyph on a benefit card, the heading, and the line. The heading holds a manual link before hydration, or plain text if the card has no page. Once the wall is live it holds the button that opens the dialog. Links, plain headings, and buttons share typography and box styles. A numeral card's number sits inside the control, so assistive technology reads the number once, as part of the heading. The control stretches over the face; the list item also completes a click whose release lands on it as the pressed face moves, returning focus to the button before opening.

A card is lit while its button has keyboard focus or a pointer that can hover is over it. A lit card's border takes the card's hue, and its glyph holds its pose. The face stays where it lies. Under a pointer it leans toward it, by the `hover-tilt` knob's angle at most. `Card.tsx` writes the pointer's place inside the hovered card to `--wall-pointer-x` and `--wall-pointer-y` on the list item. It measures the card once as the pointer enters, and each move after that is arithmetic on that box until the pointer leaves.

Where the list is one column, a benefit card sets its glyph beside its words, which shortens a phone's page. The width `wall-card.css` names for that layout is the widest viewport at which the list has one column.

The browser scrolls to a focused card's button, which is the heading's box alone. The button therefore carries two scroll margins. The first brings the card to rest clear of the pinned lens bar. The second is as tall as the tallest foot a card has under its heading, so the card's foot comes into view too.

[`site_wall_card_test.ts`](../../../tests/site_wall_card_test.ts) checks card content, accessible names, and useful server links. Browser journeys exercise navigation and the live dialog control. Appearance is reviewed directly under the [wall testing policy](wall-guards.md).

## Glyphs

A glyph is data: a list of primitives on a 48-unit grid, each painted in one of the tones `glyph_grammar.ts` defines. [`Glyph.tsx`](../../../site/wall/Glyph.tsx) draws every glyph, so the set shares one grid, stroke, and weight. [`glyphs.ts`](../../../site/wall/glyphs.ts) authors one drawing per benefit card, keyed by card id. `glyphDrawing` returns the authored drawing for a name, or a seeded drawing computed from the name alone, so no card is ever blank and both renders agree.

Server and browser must serialize a glyph to the same markup. `Math.sin`, `Math.cos`, and `Math.sqrt` can differ in their last bit between engines. The grammar therefore computes angles and lengths with arithmetic the language defines to the last bit, and it rounds every coordinate before it leaves the module. A structural guard in the glyph test rejects anything in the glyph modules that could vary between renders.

The split triangle of the discern mark is a rare accent. The recursive triangle stays reserved, as the visual identity requires. Those editorial choices are reviewed with the drawings.

### The traveling primitive

Every authored drawing marks at least one primitive to move while its card is lit, and that move enacts the card's idea. The rest drawing still carries the idea alone, because a reader who asks for reduced motion, a phone with no hover, and the social card see only the rest drawing. A seeded drawing stays still. `shift` slides a primitive by grid units. `pivot` turns it clockwise about a grid point. A primitive marked with both turns first, and the slide carries it as it stands. The lit pose is held, and nothing loops.

`glyphLayers` divides a drawing into layers in paint order. Each run of still primitives is one layer. Each run of moving primitives that share a pose is one layer, so neighbors in the list that are posed alike move as one. The renderer draws a glyph as a square box, `span.wall-glyph`, with one drawing of the same grid per layer. The first, `svg.wall-glyph-art`, is still and gives the box its picture. Every later drawing lies over it, corner to corner: a still one adds the class `wall-glyph-over`, and a moving one is `svg.wall-glyph-move`. A primitive therefore paints where its drawing lists it, whether it moves or not, and the wall at rest matches what the social card draws from the same list.

The stylesheet moves a moving drawing with `translate` and `rotate` on its box. The browser moves a box as one piece and lays nothing out again. A shape that moves inside a drawing has the browser lay out every drawing on the wall on each frame.

The renderer hands the pose to the stylesheet as custom properties on the drawing, and writes only the ones its pose sets. `GLYPH_POSE_PROPERTIES` in `Glyph.tsx` lists them:

| Property                             | Holds                                                   |
| ------------------------------------ | ------------------------------------------------------- |
| `--wall-glyph-dx`, `--wall-glyph-dy` | The slide on each axis, as a percentage of the grid     |
| `--wall-glyph-da`                    | The turn, in degrees clockwise                          |
| `--wall-glyph-px`, `--wall-glyph-py` | The point the turn is about, as percentages of the grid |

A percentage of the grid is a share of the drawing's own side. One value therefore serves the glyph on a card and the larger glyph in the sheet. `wall-glyph.css` keeps the move from costing anything beyond the drawing itself, and the glyph test reads the stylesheet to hold each rule:

- **A moving drawing always carries its slide and its turn, of nothing at rest.** A box that goes from no `translate` to some `translate` gets a new layout, and so does everything laid out with it.
- **The ease runs on three registered values and never on the move.** `translate` reads `--wall-glyph-x` and `--wall-glyph-y`, and `rotate` reads `--wall-glyph-a`. Each is a registered property that does not inherit, and `transition-property` names those three. A transition on `translate`, `rotate`, or `transform` makes the box a layer for as long as it runs, and a layer in the middle of the wall makes the browser redraw every later card. A lit rule sets where the three values go and the pace of the way there, and never what is eased.
- **The way back ends before the card's face steps back down.** The resting rule's ease is the way back, because a transition takes its pace from the state it is going to. `wall-card.css` keeps a lit face raised for a moment after it rests, and the way back is shorter than that hold. The way in belongs to the lit rules. It runs longer and goes a little past the pose before it settles. The face is raised for as long as the card is lit, so the way in may outlast the hold.

A pose is judged by how far it carries its primitive. `poseTravel` measures that in grid units: the longest way any telling point of the primitive goes, such as a corner, an end, or a center. On a card, a grid unit is about 1 pixel. [`glyph_grammar.ts`](../../../site/wall/glyph_grammar.ts) exports the bounds and holds their values:

| Constant           | Meaning                                                              |
| ------------------ | -------------------------------------------------------------------- |
| `GLYPH_TRAVEL_MIN` | The least travel that reads on a card. Less is a twitch with no ease |
| `GLYPH_SLIDE_MAX`  | The farthest slide: a quarter of the grid                            |
| `GLYPH_TURN_MAX`   | The widest turn, in degrees either way: half a turn                  |
| `GLYPH_MOVING_MAX` | The most moving drawings in one glyph                                |

The glyph test rejects an authored glyph with no move. It also rejects a slide or a turn past its bound, too many moving drawings, a pose that travels less than `GLYPH_TRAVEL_MIN`, and a pose that shows nothing. A circle turned about its own center is one: its center, the only telling point it has, stays put.

Where a pointer can hover, the pose carries through the opening. The source card keeps the pose while the hook marks it, and the opened card draws its own glyph in the same pose. [A marked card holds still](wall-opened-card.md#what-a-transition-costs), so its glyph takes the pose at once, and eases back to rest when the mark goes.

A reader who asks for reduced motion gets every glyph at rest: the stylesheet poses a drawing only where motion is allowed.

### The set

A dashed stroke gives up part of its length to gaps. The renderer marks a dashed shape with a second class, and the stylesheet draws it heavier than a whole stroke so that it reads at card size.

`wall-glyph.css` paints every tone from `currentColor`. The glyph test requires a card in the deck to draw every authored key.
