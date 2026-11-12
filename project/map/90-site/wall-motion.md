---
aliases:
  - tuning panel
  - wall motion contract
  - wall far view
---

# The wall's motion and tuning

How [the homepage wall](the-homepage-wall.md) moves, what a visitor's settings change, and the values the tuning panel exposes. That page names the files and tests this page refers to.

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

## Forced colors, more contrast, and print

Forced colors get flat cards in system colors and no light. The lens bar takes a solid system-color backing with a rule along its foot, so no chip sits on a card's words. The card test holds the cards' part, and the light test emulates forced colors in a browser for the room's.

A visitor who asks for more contrast gets the room's quieter inks nearer to its full ink. The chips, the divider, and the close control get firmer edges, and receded cards come nearer to full strength. The browser test holds the inks, a chip's edge, the divider, and the receded card, which must still read as set aside.

On paper the room is a plain light sheet with no bar, no link past the cards, no grain, no light, and no dark margin. Receded cards print at full strength. With a card open, paper still gets the wall. The sheet and its backdrop stay off the page, the card it grew from shows in its own place, and the page prints at its full width and length. The card test holds the cards' part, the light test emulates print for the room's, and the sheet test prints with a card open.
