---
aliases:
  - wall columns
  - wall masonry
---

# The wall's columns

Part of [the homepage wall](the-homepage-wall.md), which names the files and tests this page refers to.

The cards are the items of one list, `ul.wall-list`. [`wall.css`](../../../site/page-src/wall.css) lays it out as CSS multi-column: four columns, five on a wide screen, and fewer wherever a column would be too narrow. The list fills each column from its top in the list's own order, so reading order, focus order, and DOM order agree. The list's order alone places a card.

[A lens](wall-lens.md) re-sorts the list. Its divider spans every column, so the cards it kept fill one run of columns and the cards under the divider fill another.

## A card is one line

[`wall-card.css`](../../../site/page-src/wall-card.css) makes a card an inline block as wide as its column. Each card is then one line of the list, and its top margin is the gap. A column breaks between lines and never inside one. Every card therefore stays whole, and Chrome and WebKit each report one box for it. [The hover tilt](wall-deck-cards-and-glyphs.md#cards) and [the flatness measure](wall-opened-card.md) both read that box.

The line of the card that heads a column starts at the column's top. The card's own box starts one gap below it. Whatever a card draws outside its box ends within the gap: its shadows, its lit layers, its lean, and its focus ring. A card's ink therefore lies wholly inside its column.

Smaller rules follow from the gap's place:

- **The list pulls up by one gap.** The first row would otherwise stand one gap low. `.wall-plane` is a flow root, so the list's negative margin stays inside the plane. The plane's top edge, which the far view hinges on, stays put.
- **The divider gives the gap back.** Its end margin subtracts the gap, so the cards under it keep their distance from it.
- **A column may hold one card.** The list sets `orphans` and `widows` to 1. A browser otherwise keeps two lines together at the head and the foot of a column.
- **Paper keeps blocks.** Paper has no layers, and a gap at the head of every column of every sheet would cost each sheet a card. On paper a card is a block with the gap under it, kept whole, and the list and the divider give back what they took for the gap.
- **The face contains its layout.** Chrome lays a line out again when a box in it starts or stops moving, and a hovered face does both. `.wall-card-face` sets `contain: layout`, so a hover lays nothing out.

## What keeps every card drawn

WebKit draws a box of a multi-column list wrongly once that box paints through a layer of its own. The stylesheets keep every card clear of that:

- **The list is one stacking context.** `.wall-list` sets `isolation: isolate`. A layer the browser composites beside the list then lifts the list as one layer. The far view's horizon is such a layer, beneath the cards. With an open list, WebKit lifts each card over the horizon into a layer of its own. A hovered face rises in the stack inside the list alone. So the list itself draws the far view's haze, over its cards and under a raised face, and a far card under the pointer stands clear of it. The plane draws nothing over the list.
- **No card's ink starts higher than its column.** WebKit draws a lifted card in the column before when its ink starts higher than its own column's top. That column clips the card away, or shows it among other cards. A hovered or pressed face is a layer too. The gap inside the card's line keeps every card clear.
- **A card with a layer of its own contains its paint.** [The opened card's source](wall-opened-card.md) carries the sheet's view-transition name while the two morph, and has no opacity while the sheet is open. Either gives the list item a layer, and WebKit then leaves the cards after it in the list out of the page's picture. `.wall-card[data-wall-opening]` therefore sets `contain: paint`. It takes the face's radius too, so the box that clips it has the card's shape.

A receded card also paints through a layer, because a lens lowers its opacity and removes its color. It carries no containment. It draws its light, its lean, and its focus ring outside its box, and containment would cut them off. WebKit draws a receded card, and the cards after it, in place.

## Reviewing the columns

Review the rendered wall in Safari and Firefox when changing column layout or compositing rules. Check that cards remain visible and usable through a lens change and an opened card. The shared browser journeys check that the deck survives a lens change and fits a narrow page. They do not prescribe column coordinates, shadow extents, or the CSS used to obtain them. See [the testing scope](wall-guards.md#testing-scope).
