---
aliases:
  - opened card
  - wall sheet
---

# The opened card

Part of [the homepage wall](the-homepage-wall.md), which names the files and tests this page refers to.

Activating a card opens it as a sheet in a modal dialog. [`useOpenCard`](../../../site/wall/use_open_card.ts) owns which card is open and carries every change. [`OpenCard`](../../../site/wall/OpenCard.tsx) renders the dialog only while a card is open. The sheet shows the card's glyph or numeral, its heading, its line, the optional second paragraph, and a link when the card names a manual page.

The link takes its words from the title of the page it leads to. `OpenCard` looks the page up in the `linkLabels` prop by route, without any section the address names. A label therefore cannot drift from the manual, and a link to a section carries its page's title.

The close control comes first and takes focus. A sheet too tall for a small or zoomed screen scrolls inside itself, and a browser that can focus a scrolling box would choose that box first. `OpenCard` therefore hands the control the focus outright, and the stylesheet keeps it stuck in the sheet's corner while the words scroll under it. On a narrow screen, and on a wide one with a coarse pointer, the close control and the link take a finger's 44 pixels.

`openChange` picks how a card opens or closes:

| Way   | When                                                                                                           | What the visitor sees                                                    |
| ----- | -------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------ |
| Morph | The browser has view transitions, the visitor has not asked for reduced motion, and the source card lies flat. | The card grows into the sheet, and the sheet shrinks back into the card. |
| Fade  | The same, but the source card is not flat, as in the far view.                                                 | The sheet arrives and leaves where it stands.                            |
| Cut   | The visitor asked for reduced motion, or the browser has no view transitions.                                  | The change is immediate.                                                 |

A card counts as flat when its drawn box matches its laid-out box to within a pixel. A browser with no view transitions gets a short fade from the stylesheet as the sheet opens, unless the visitor asked for reduced motion.

Only a morph marks the source card, with `data-wall-opening`. The value `morph` gives the card the sheet's view-transition name: for the picture the browser takes before the sheet grows from it, and while the sheet returns to it. The value `held` hides the card while the sheet is open, so its place on the wall stays empty and nothing reflows. At most one card carries the attribute, and none carries it after a close finishes. A marked card contains its paint, which [WebKit needs](wall-columns.md#what-keeps-every-card-drawn) of any card that has a layer of its own.

## The morph

The card and the sheet share one view-transition name, so the browser grows one into the other. `wall-interactions.css` shapes what a visitor sees between them:

- **The words change in sequence.** The outgoing picture finishes its fade before the incoming one starts, on the way out and on the way back. Between them the moving box shows its own plain surface.
- **The mark crosses as an object of its own.** The card's glyph or numeral has a second view-transition name. The card's mark carries it while the card carries the shared name, and the sheet's mark carries it while a card is the sheet's source, so the name never stands on two boxes. The mark's two pictures take their scale from the box's height, because a numeral's box is as wide as its heading. The sheet sets a numeral as the card does, a size up, so the two pictures lie on each other.
- **The incoming picture's fit depends on the direction.** On the way out it fills the growing box. On the way back it is the card's picture, which is shorter for its width than the box. It keeps the box's width and its own shape there, so the browser draws no line of the card cut at the box's edge.

A receded card's mark stays in the card's picture. The browser lifts a named box out of whatever dims its card, and the mark would arrive at a dimmed card at full strength. A sheet with no source card, as in the far view, arrives and leaves whole.

## Requests, clicks, and faults

Each request states where the wall should end, so opens and closes that overlap settle in one whole state. A held key opens the sheet once.

Escape, the close control, and a click outside the sheet each close it, and focus returns to the card. The page behind keeps its scroll position and its width while the dialog is open.

While a sheet's view transition runs, the browser hands a pointer event to nothing the visitor sees. As the sheet arrives, the page behind it is inert and the transition draws the sheet's face from its pictures, so every event lands on the dialog itself. As the sheet leaves, the page's old picture lies over the page, and every event lands on the document's root. Script therefore reads such a click by where it fell:

- A click outside the arriving sheet closes it from the moment the dialog mounts.
- A click inside the arriving sheet ends the transition and reaches what it fell on, from the moment the dialog mounts. The close control and the link answer while the sheet still arrives. A click on the sheet's words hands the sheet the focus, as a press on them does once the sheet rests.
- A click on the page while the sheet leaves ends the transition and reaches the link or button under it.

Once the sheet rests, the browser tests the page for a hit again, and script reads no click by its place. An event on the dialog is then the backdrop's, the slivers outside the sheet's rounded corners included, and a click there closes the sheet.

A double click is one act. Its later clicks land wherever the first has left the page. Under reduced motion the sheet is in place within the first click, so the second can fall on the sheet's link or its close control. `useClickSequence` in `use_open_card.ts` marks a click sequence as spent once one of its clicks has opened or closed a card, or chosen a lens. It then drops the rest of that sequence before anything on the page hears it. The press that begins a dropped click is stopped from acting too, so it takes no focus: the focus stays in the sheet the first click opened, or on the card a closed sheet handed it back to. A click that starts a sequence of its own reaches the page as usual.

`deliverClick` in `use_open_card.ts` makes a click on a visitor's behalf, for the arriving sheet, the leaving sheet, and the lens's cross-fade, and no other function does. It hands on a plain click alone: the primary button, with no modifier key held. A click made by script keeps no modifier and no button, so a link meant for a new tab would open in place. Any other click therefore ends the transition and goes nowhere, and the visitor makes it again on a page that answers for itself. The hook also listens for `auxclick`, which is how a click of another button arrives.

A view transition can fail to begin. `transitionOvertaken` sorts the browser's reason into expected and fault. It expects a hidden page, a later request that ends an earlier transition, and a viewport that changed size since the request. The page still reaches the state the request named. Anything else goes to `reportError`. An invalid state with the viewport unchanged is how the browser reports a transition name on two boxes.

A browser can also refuse a transition outright, by throwing when asked to begin one. `beginTransition` reports the refusal, and the sheet and the lens then make the change as a cut.

## What a transition costs

While a view transition runs, the browser draws the page from pictures. A change to the page under them costs a redraw on every frame, and a visitor sees none of it. The page therefore keeps still for as long:

- **The pointer light holds still.** `beginTransition` begins every view transition on the site, for the sheet and for the lens. Each caller waits for the end through `transitionEnded`. `transitionRunning` answers from those two, and [the light](wall-pointer-light.md#how-the-light-comes-and-goes) writes nothing while one runs.
- **A sheet's transition pictures the page once.** `useOpenCard` marks the page's root with `data-wall-sheet-moving` as the page changes, and clears the mark when the transition ends. Under that mark `wall-interactions.css` takes the root's transition name away. The browser has taken the page's old picture by then, and takes no new one. The old picture fades out over the page itself, which is the same cross-fade to the eye. WebKit draws a new picture of the root afresh on every frame, as large as the viewport, and its main thread waits for each one. A lens leaves the root its name and cross-fades both pictures.
- **The sheet's shadow has a picture of its own.** The dialog draws the shadow, and carries the transition name `wall-open-shadow` for it. With the root out of the transition, Chrome draws nothing of the dialog itself while the transition pictures the face inside it. A shadow left to the page would then arrive at once as the transition ended. Pictured, it fades in and out where the sheet rests, on the clock of the root's pictures. A browser stacks a picture that only the new state has over every other. The rule that times the sheet's box therefore raises that box, and the mark with it, over the shadow.
- **The scroll bar's width stays on the root.** `OpenCard` writes `--wall-open-scrollbar` on the page's root as a sheet opens and removes it as the sheet closes. The root alone reads it, to pad the page by the scroll bar an open sheet takes away. `wall-interactions.css` registers the property so that it does not inherit. An inheriting value written on the root would restyle every element on the page a second time at each change, and the repaint WebKit makes for a modal dialog would cost more.
- **The source card holds still.** While a card carries `data-wall-opening`, its face has no transform, and nothing in the card eases. The face, its two layers, and the drawing of a glyph that travels each take their look at once. The browser reports the pointer gone from the card as the transition begins, and the face would otherwise ease out of its hover pose unseen. A face that moves has a layer of its own. Inside a marked card that layer cannot rise over the wall, so Chrome lifts every card after it into further layers and draws them again.

A request that a later one overtook still makes its change, and makes it before the later transition takes its first picture. Only the latest request marks the root, or that picture would lack the page.

The still card needs the root out of the transition. While WebKit pictures the root on every frame, a face that holds still makes its frames late.

Where a pointer can hover, the visitor pressed a lit card, and the browser lets go of the hover before it takes the card's picture. The root's mark says when the page has changed. Until then a card that carries the sheet's name keeps its lit face, so an opening pictures the card as the visitor pressed it. The hook marks a card the sheet returns to after the page has changed. That card arrives unlit unless the keyboard's focus is on it, and that focus lights it at once.

[The transition test](../../../tests/site_wall_transition_test.ts) reads these from the stylesheets and the sources, because the gate's browser draws a sheet the same with or without them. It names every rule that reads the root's mark. It requires the dialog and its face to go by a name each, and the sheet's box to stack over the shadow's. It works out which boxes a marked card must still: each box inside a rendered card that some rule moves or gives time, by the property that does it. A new moving part of a card fails the test until the marked card stills it. It fails with the reason when the face holds still and no rule takes the root's name away.

From the sources the test requires that one line of the site begins a view transition, and that each module waits through `transitionEnded` for every transition it begins. A transition begun elsewhere would run with the light still writing. One never waited for would hold the light for good.

Opening or closing a card makes the browser restyle every element on the page once. The modal dialog costs that by itself: an empty dialog opened over the homepage restyles as much, and marking the source card restyles about a dozen elements. It happens once per change, and no test counts it.

## What holds the opened card

The interactions test holds the decisions and the stylesheet:

- `openChange`, the flatness measure, `transitionOvertaken`, and the definition of a plain click;
- a style for every state in `OPENING_STATES`;
- the sheet's link, named by its page;
- a structural guard that no other line under `site/` makes a click, and that `deliverClick` refuses any click but a plain one before it reads the page.

The columns test holds the marked card's paint containment, with [the list's other rules](wall-columns.md#what-holds-the-columns). The transition test holds [what a transition costs](#what-a-transition-costs).

The sheet test opens a card by pointer and leaves by every entry in its `WAYS_OUT` table, in the far view and in the near view. After each one, the scroll position, the plane, every card's box, and the focus must be where they began. A new way out belongs in that table. Its further cases cover:

- a double click, a press on the arriving sheet, and overlapping requests;
- a browser that refuses to begin a transition, for a card and for a lens;
- a sheet too tall for its screen, with the close control focused, in its corner, and in reach after the sheet scrolls.

Under reduced motion, the browser test opens every card in the deck by keyboard. It checks each sheet's name, and compares each link's name with the manual's titles.
