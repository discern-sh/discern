---
aliases:
  - wall lens
  - receded cards
---

# The lens and receded cards

Part of [the homepage wall](the-homepage-wall.md), which names the files and tests this page refers to.

The lens bar sits at the top of the wall and stays pinned as the reader scrolls. [`Lens.tsx`](../../../site/wall/Lens.tsx) renders "Everything" and one chip per `WALL_LENSES` entry. Each chip is a toggle with `aria-pressed`, and pressing the active chip lets the lens go. A lens chip carries one dot per cluster it gathers, in that cluster's hue. A little under the width where the row fits, the chips close up, so the row still fits a wide laptop.

## When the row does not fit

Where the chips do not fit one row, they sit in `.wall-lens-strip`, a strip as wide as the screen that scrolls sideways and draws no scroll bar. The group `.wall-lens` around it keeps the bar's width and holds the strip, two step controls, and the status. The arrival and exit fades in `wall.css` set `pointer-events` on `.wall-lens`. Everything in the group inherits it, so the step controls take no press while the bar is half gone, as the chips do.

- **The active chip comes into view.** An effect on the active lens moves its chip to the middle of the strip, however the lens became active. A chip the keyboard reaches moves there too. A chip focused by a pointer's press stays put, or the click would miss it. Only the strip scrolls. The page stays where the lens put it. During the lens's cross-fade the strip jumps, so the fade's new picture already shows the chip. Otherwise the strip's `scroll-behavior` decides: a glide, or a jump under reduced motion.
- **A side fades only when it has more.** The strip measures itself on its own `scroll` event and through a `ResizeObserver`. Nothing measures it as the page scrolls. `stripEdges` decides which sides have more past them, and the strip carries `data-more-start` and `data-more-end` for those sides. Only those attributes turn on the mask. The server renders neither, so the server's markup and the browser's first render agree. An effect measures the strip once the page is live.
- **A pointer steps the strip.** Under `(hover: hover) and (pointer: fine)`, a round control sits over each side that has more, in line with the cards' edge. It is absolutely placed, so it moves no chip when it appears. `steppedScroll` brings the first chip that side cuts to the strip's opposite side, so each step shows a fresh run and every chip is reachable. The controls are named buttons outside the tab order, and a press on one keeps the focus where it was. The keyboard already reaches every chip, and a focused control that hid itself at the end of the row would drop the focus. The wheel scrolls the page as usual. A touch screen swipes the strip and gets no controls.

The fade's width is the strip's `scroll-padding-inline`, and script reads it from there, so script and the eye agree on which chips are clear of it. Under a fine pointer the fade reaches past the step control, so no chip shows beside it. `centeredScroll` and `steppedScroll` take plain numbers. The interactions test checks across screen widths that the active chip ends clear of every fade and that steps from either end show every chip. It also checks that only a measured side fades and only a side with more draws a control.

## How a lens orders the wall

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
