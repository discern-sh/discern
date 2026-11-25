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

The island test checks that the knob table supplies the root's defaults.

Add a knob by adding one entry to the table and reading its property in a stylesheet or a source file. The panel lists whatever the table holds.

The tuning panel is a development aid. It appears only when the address carries a `tune` query parameter, as in `/?tune`, and only after the island has mounted. It shows one range control per knob, copies the current values as JSON, and resets them to the defaults. The panel edits the same inline properties the server wrote, so a change shows in place. The site carries its own panel because the Content Security Policy refuses the run-time styles that third-party panels inject.

## Motion contract

Calm motion is a requirement of the page:

- Pointer travel changes the light; only the hovered card lifts and tilts.
- A lit card's glyph eases into [a pose](wall-deck-cards-and-glyphs.md#the-traveling-primitive) and holds it. It eases back when the card is no longer lit. Nothing in a glyph loops or moves by itself.
- Scroll moves the wall as one plane. Keyboard focus brings that plane flat for reading and navigation.
- A lens changes the list's order through a cross-fade, without cards traveling across the screen.
- An opened card grows from a flat source, or fades in place when the source is far away. Its glyph or numeral crosses with it.
- Phones, reduced motion, and forced colors get the flat wall. Reduced motion removes the light's fade and ease, card and lens changes use a cut, and every glyph stays at rest.
- Hover and the light apply only to a pointer that can hover.
- The shipped defaults have no ambient drift. Enabling drift in the tuning panel exposes a pause control.

The browser journeys check usable keyboard navigation and reduced-motion card and lens changes. Pure tests check transition choices and light arithmetic. Review decorative timing and movement directly, under [the wall's testing scope](wall-guards.md#testing-scope).

### The approach

The approach itself is CSS. Where the browser supports scroll-driven animation, [`wall.css`](../../../site/page-src/wall.css) ties the plane's tilt and distance to scroll. The headline pool leaving the viewport times it, so the wall is flat when its top reaches the top of the viewport. No script measures or moves anything while the page scrolls. The stylesheet stages the approach only on a large screen with a fine pointer that can hover, and only for a visitor with no reduced-motion or forced-colors preference. The page is complete without script in either state.

[`use_stage.ts`](../../../site/wall/use_stage.ts) defines a stage as a `mount` function that takes the wall root and returns the function that restores it. `useStage` runs one stage. The approach is the only stage, and the interface exists so another can replace it.

The stage sets `data-wall-near`, which the module exports as `NEAR_ATTRIBUTE`, whenever the plane is flat and carries no transform. That holds where the stylesheet stages no approach, once the pool has left the viewport, and from the moment keyboard focus reaches the stage until the focus leaves it. The far-view rules in `wall.css` stand down under that attribute, and the light reaches card borders only under it.

The haze and horizon glow default to transparent. Their shared `wall-far-only` animation supplies the visible opacity once its scroll timeline has resolved. Re-entering the far view therefore does not show either layer at full strength while the browser attaches the timeline.

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

The focus selectors stay on the boxes they style. A `:has()` on `.wall` would make the browser restyle every element under the wall root at each keyboard step.

The stage's first control is a link, "Skip the cards". The stylesheet draws it only while it holds the focus. It leads to the closing section's heading, which takes the focus.

### The lens bar's arrival and exit

The lens bar arrives over the last of the approach. It only fades, so an unseen bar stays in the tab order and in the accessibility tree. Its chips take no press until the bar is half seen.

At the foot of the wall the bar fades out as the closing section comes in, and its chips take no press once the bar is half gone. No screen then ends with the bar cut by the viewport's edge. That fade follows scroll, so it runs under reduced motion too. Keyboard focus inside the bar shows it whole wherever the page stands, and so does a press on the bar. A pointer that presses a chip there takes the focus from the keyboard, and the bar stays under the press. On a screen shorter than 30rem the bar stays at the head of the wall instead of pinning.

## Forced colors, more contrast, and print

Forced colors get flat cards in system colors and no light. The lens bar takes a solid system-color backing with a rule along its foot, so no chip sits on a card's words.

A visitor who asks for more contrast gets the room's quieter inks nearer to its full ink. The chips, the divider, and the close control get firmer edges, and receded cards come nearer to full strength.

On paper the page is the room alone, as a plain light sheet with no bar, no link past the cards, no grain, no light, and no dark margin. The page takes the light scheme's system colors there. The site header and footer stay off the paper, because the package inks them from the page's [dark theme](design-system-consumption.md#build-and-theme), which has no print form. Receded cards print at full strength, and [a card prints as a block](wall-columns.md#a-card-is-one-line) with the gap under it. With a card open, paper still gets the wall. The sheet and its backdrop stay off the page, the card it grew from shows in its own place, and the page prints at its full width and length. The theme browser test checks readable ink on paper.
