---
aliases:
  - wall lens
  - receded cards
---

# The lens and receded cards

Part of [the homepage wall](the-homepage-wall.md), which names the files and tests this page refers to.

The lens bar sits at the top of the wall and stays pinned as the reader scrolls. [`Lens.tsx`](../../../site/wall/Lens.tsx) renders "Everything" and one chip per `WALL_LENSES` entry. Each chip is a toggle with `aria-pressed`, and pressing the active chip lets the lens go. A lens chip carries one dot per cluster it gathers, in that cluster's hue. Where the chips do not fit one row, they form a strip that scrolls sideways, and a chosen or keyboard-focused chip moves to its middle. A little under the width where the row fits, the chips close up, so the row still fits a common laptop.

A lens re-sorts the list. `lensGroups` splits the deck into the cards the lens kept and the rest, each group in the deck's own order. `WallPage` renders the kept cards, then one divider, then the rest. The divider is a list item, `li.wall-rest`, that reads "Everything else" and spans every column, so [a second run of columns](wall-columns.md) starts under it. A card keeps its element when the order changes, so the list's order is the only thing a lens moves. With no lens the list is the deck and holds no divider.

A card under the divider recedes. It carries `data-receded`, and `wall-interactions.css` lowers its opacity and removes nearly all its color. The card stays in the list, where a visitor can still read, focus, and open it. Pointing at a receded card, or reaching it by keyboard, brings that one card back up.

The opacity has a floor. A receded card's title and line must both keep a contrast of at least 4.5 to 1. The interactions test computes that contrast from the stylesheets' own colors. The loss of color is what makes the card read as receded.

`useLens` owns the active lens and how a change shows:

- **One cross-fade, or a cut.** Where the browser has view transitions and the visitor has not asked for reduced motion, the page cross-fades once, as one picture, from one order to the other. Otherwise the change is a cut. No card has a transition part of its own, so no card travels across the screen. [The pointer light](wall-pointer-light.md#how-the-light-comes-and-goes) holds still while the fade runs.
- **A jump to the head of the wall.** The kept cards now lead the wall. In the same frame, a reader who has scrolled past the head of the wall comes back to it at once. A reader who can see the head stays put. `.wall-list` sets `overflow-anchor: none`, or the browser would scroll the page after whichever card it had anchored.
- **The last request wins.** Each request states the lens the wall should end with, and a later cross-fade ends an earlier one where it stands.
- **A press made during the fade still lands.** While the cross-fade runs, the browser sends every click to the document's root. The first click ends the fade, and a plain one reaches what it fell on through `deliverClick`, the function [the opened card](wall-opened-card.md) uses.
- **A double click chooses once.** Its second click would let the chosen lens go again. [The click sequence](wall-opened-card.md#requests-clicks-and-faults) drops it, under a cross-fade and under a cut.

The lens also says in words what it did, for a reader who cannot see the cards regroup. A status region, `p.wall-lens-status` with `role="status"`, sits inside the lens group. It is in the server's markup, empty, so assistive technology is already listening when a lens first fills it. `lensStatus` writes a sentence such as `9 cards for "Review less". The other 59 follow under "Everything else".` The stylesheet never draws the region.

The interactions test checks every lens's groups, order, status sentence, and pressed state. The browser test selects and clears a representative lens at phone and laptop sizes, checks the resulting card order and status, and requires the page to remain usable. Decorative cross-fade timing and exact chip geometry are reviewed directly.
