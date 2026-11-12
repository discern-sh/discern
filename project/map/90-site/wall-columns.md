---
aliases:
  - wall columns
  - wall masonry
---

# The wall's columns

Part of [the homepage wall](the-homepage-wall.md), which names the files and tests this page refers to.

The cards are the items of one list, `ul.wall-list`. [`wall.css`](../../../site/page-src/wall.css) lays it out as CSS multi-column: four columns, five on a wide screen, and fewer wherever a column would be too narrow. The list fills each column from its top in the list's own order, so reading order, focus order, and DOM order agree. The list's order alone places a card.

[A lens](wall-lens.md) re-sorts the list. Its divider spans every column, so the cards it kept fill one run of columns and the cards under the divider fill another.

## What keeps every card drawn

WebKit draws a box of a multi-column list wrongly once that box paints through a layer of its own. The stylesheets keep every card clear of that:

- **The list is one stacking context.** `.wall-list` sets `isolation: isolate`. A layer the browser composites beside the list then lifts the list as one layer. The far view's horizon is such a layer, beneath the cards. With an open list, WebKit lifts each card over the horizon into a layer of its own.

## What holds the columns

Chrome draws the wall whole with or without this rule, and the gate launches Chrome only. [`tests/site_wall_columns_test.ts`](../../../tests/site_wall_columns_test.ts) therefore reads it from the stylesheets: one base rule isolates the list, and no rule for any state of the wall says otherwise. The same file loads the built page in Chrome at four columns and at five, and requires an isolated list at each.

No test runs WebKit, and [`project/TODO.md`](../../TODO.md) carries that gap.
