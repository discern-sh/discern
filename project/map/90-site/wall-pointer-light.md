---
aliases:
  - pointer light
---

# The pointer light

Part of [the homepage wall](the-homepage-wall.md), which names the files and tests this page refers to.

One light follows a mouse or pen across the wall. [`useLight`](../../../site/wall/use_light.ts) writes its place and its brightness, at most once per frame. The stylesheets draw it on the canvas and on card borders:

- **On the canvas.** `.wall::before` is one soft disc under everything in the room. The hook writes the light's place, measured from the wall root's corner, to `--wall-light-x` and `--wall-light-y` on the root. It writes how far the light has come up to `--wall-light-on`. The disc follows through `translate` and fades through `opacity`.
- **On card borders.** Each card's face holds an empty box, `span.wall-card-light`, masked down to the one-pixel border ring. For each card within reach of the light, the hook writes the light's place from that card's own corner to `--wall-card-light-x` and `--wall-card-light-y` on that box, with `--wall-card-light-on` beside them. It removes all three when the card falls out of reach. The ring is white and faint, the same on every card the light reaches. A card shows its own hue only while it is lit.

The stylesheet decides the reach. `--wall-light-reach` on the root is zero at rest. It equals the light's throw only under `.wall[data-wall-near]`, on a screen with a pointer that can hover. So no card takes the light while the plane tilts away, or on a touch screen. `LIGHT_REACH_GATES` in `use_light.ts` names those two conditions, and a change in either makes the hook read the reach again. A rule that set the reach by any other state would change it unseen, so the card test fails on such a rule. It also requires the reach and the box's own gradient to name the same throw.

## What a frame costs

A custom property inherits unless a stylesheet registers it otherwise. An inheriting property written on the root every frame makes the browser restyle every element in the wall every frame. The stylesheets therefore register each property that script writes during pointer travel with `@property` and `inherits: false`. A box takes one only by declaring `<name>: inherit`, and only a box that draws with the value may ask.

A browser that restyles an element also looks again at that element's children. The border light therefore lives on an empty box. On the face, the same value would cost the glyph, the heading, and the line a second look each frame.

A frame of pointer travel restyles the root with its pseudo-elements and its three sections, and one empty box in each card near the pointer. The card under the pointer restyles its own face as well, and a card restyles whole once as the pointer enters or leaves it. None of those counts grows with the deck.

Selected text costs too. The browser works out an element's `::selection` style each time it restyles that element, and a highlight rule that reads a design-system token is slow to work out. `wall.css` names the room's selection colors itself and reads no token. Selected words keep their own color on a blue wash, which stays readable on every surface in the room.

## Where the light reads layout

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

## How the light comes and goes

- The light comes up where the pointer is and goes down where it stands, over the `light-fade` knob's milliseconds. It never sweeps in from an edge.
- While up, it eases toward the pointer over the `light-ease` knob's milliseconds and stops writing once it arrives. A still pointer costs nothing.
- A pointer that jumps farther than the light's own size draws no light across the wall. The light goes dark in place and comes up at the pointer.
- A page that scrolls under a still pointer moves the pointer's place on the wall, and the light follows the same way.
- Reduced motion removes the fade and the ease. The light is where the pointer is, at once.
- Touch never moves the light, and it holds still while the pointer is over an opened card.
- The light writes nothing while a view transition runs: a card that opens or closes, or a lens that re-sorts the wall. `transitionRunning` in [`use_open_card.ts`](../../../site/wall/use_open_card.ts) says when one does. The browser reports the pointer gone from the wall as a transition begins. A light that went down then would redraw the wall on every frame, under pictures that hide it. It goes down once the transition has ended, and follows the pointer again from there.
- Forced colors and print draw neither the disc nor the boxes.

The disc anchors no scroll. A browser holds the page still under a reader by picking a box in view and scrolling after it when it moves. WebKit picks the disc, the first box in the room. It then scrolls the page after the light whenever a write of the light's place meets a layout, as it does at the end of a view transition. `.wall::before` therefore sets `overflow-anchor: none`.

[`site_wall_light_test.ts`](../../../tests/site_wall_light_test.ts) holds the light through plain, stylesheet, and browser tests:

- Plain tests check the arithmetic of `lightStep`, `lightFrame`, and `lightGap`, at the pace `lightPace` builds from the knob table.
- Stylesheet tests take the list of frame-written properties from `LIGHT_PROPERTIES` in `use_light.ts` and `POINTER_PROPERTIES` in `Card.tsx`, so a new property enrolls itself. Each must register as non-inheriting. So must the property [the opened card](wall-opened-card.md#what-a-transition-costs) writes on the page's root, which only a rule for the root may read. A module that sets a property on a box of the page must enroll the names it sets. No state of the wall root may change an inheriting property. No highlight rule in a wall stylesheet may read a `--discern-` token.
- A further test moves the wall down the page, scrolls the page under a still pointer, and swaps two cards of one size. The light must stay under the pointer each time.
- Further browser tests watch the light come up, jump, and go down. They require no write from a finger.

[The transition test](../../../tests/site_wall_transition_test.ts) holds the light through a view transition. It opens and closes a card by pointer, far and near, and chooses a lens, at the laptop size and at five columns. No style write may reach the wall root or a card's light box while a transition is active, and the light must follow the pointer once each has ended. It also reads the disc's rule from the stylesheet: a box that moves by a value in `LIGHT_PROPERTIES` must opt out of scroll anchoring.
