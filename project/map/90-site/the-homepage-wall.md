---
aliases:
  - homepage wall
  - benefit wall
---

# The homepage wall

The homepage body is one wall of small cards between the shared site header and footer. Each card states one thing discern does. A visitor scans the cards in any order and brings one group to the head of the wall with a lens. Opening a card shows a second paragraph and a link into the manual.

The headline pool stands above the wall and a closing section below it. Each offers the link into the manual and a control that copies [the setup prompt](#the-setup-prompt).

The wall is the site's only hydrated React island ([ADR 0430](../_adr/0430-the-homepage-ships-one-hydrated-react-island.md)). The server renders the complete page, and the browser then hydrates the wall so its controls respond. No other route sends a framework runtime to the browser.

The page is dark for every visitor, whatever their device asks for or they chose elsewhere on the site, and it offers no theme control. Its document declares [the `dark` theme](design-system-consumption.md#build-and-theme).

## Pages

| To change or understand                                                                     | Read                                                                |
| ------------------------------------------------------------------------------------------- | ------------------------------------------------------------------- |
| How the page is rendered, hydrated, and built                                               | [The wall's server render and build](wall-render-and-build.md)      |
| A card's words, a lens, a card's markup, or a glyph                                         | [The wall's deck, cards, and glyphs](wall-deck-cards-and-glyphs.md) |
| The scroll approach, keyboard focus, reduced motion, forced colors, print, or a tuning knob | [The wall's motion and tuning](wall-motion.md)                      |
| The light that follows the pointer, and what it costs                                       | [The pointer light](wall-pointer-light.md)                          |
| How a lens regroups the wall                                                                | [The lens and receded cards](wall-lens.md)                          |
| The multi-column list, a card's place in it, and what keeps every card drawn                | [The wall's columns](wall-columns.md)                               |
| The sheet a card opens into, its transitions, and hurried input                             | [The opened card](wall-opened-card.md)                              |
| How the headline and the line beneath it break at each width, and what the pool may hold    | [The headline pool](#the-headline-pool)                             |
| The setup prompt's words, a copy control, or what a refused copy does                       | [The setup prompt](#the-setup-prompt)                               |
| Which agents the pool's row shows, and how a mark is drawn                                  | [The row of agents](#the-row-of-agents)                             |
| Which test holds which rule                                                                 | [The wall's guards](wall-guards.md)                                 |

## Where each concern lives

Components, hooks, and data live in [`site/wall/`](../../../site/wall/). Stylesheets live in `site/page-src/`.

| Concern                                                    | Source                                                                                                                                                                                                                               | Guard                                                                                                                                                                  |
| ---------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Document shell, island host, link labels, and the agents   | [`HomePage.tsx`](../../../site/ui/pages/HomePage.tsx)                                                                                                                                                                                | [`site_wall_island_test.ts`](../../../tests/site_wall_island_test.ts)                                                                                                  |
| The page's fixed dark theme                                | [`HomePage.tsx`](../../../site/ui/pages/HomePage.tsx), [`site/theme.ts`](../../../site/theme.ts)                                                                                                                                     | [`site_theme_test.ts`](../../../tests/site_theme_test.ts), [`site_homepage_theme_browser_test.ts`](../../../tests/site_homepage_theme_browser_test.ts)                 |
| The headline pool's line breaks                            | [`wall.css`](../../../site/page-src/wall.css)                                                                                                                                                                                        | Direct visual review                                                                                                                                                   |
| Page body and root state                                   | [`WallPage.tsx`](../../../site/wall/WallPage.tsx)                                                                                                                                                                                    | [`site_homepage_browser_test.ts`](../../../tests/site_homepage_browser_test.ts)                                                                                        |
| The setup prompt, its copy controls, and their status      | [`SetupPrompt.tsx`](../../../site/wall/SetupPrompt.tsx), [`wall.css`](../../../site/page-src/wall.css)                                                                                                                               | [`site_wall_island_test.ts`](../../../tests/site_wall_island_test.ts), [`site_homepage_browser_test.ts`](../../../tests/site_homepage_browser_test.ts)                 |
| The row of agents                                          | [`WorksWith.tsx`](../../../site/wall/WorksWith.tsx), [`HomePage.tsx`](../../../site/ui/pages/HomePage.tsx), [`wall.css`](../../../site/page-src/wall.css)                                                                            | [`site_wall_island_test.ts`](../../../tests/site_wall_island_test.ts), [`site_homepage_theme_browser_test.ts`](../../../tests/site_homepage_theme_browser_test.ts)     |
| Seam between server render and island                      | [`host.ts`](../../../site/wall/host.ts), [`island.tsx`](../../../site/wall/island.tsx)                                                                                                                                               | [`site_wall_island_test.ts`](../../../tests/site_wall_island_test.ts)                                                                                                  |
| Built assets, the island's file name, and its cache policy | [`assets.ts`](../../../site/wall/assets.ts), [`site/build.ts`](../../../site/build.ts), [`site/serve.ts`](../../../site/serve.ts)                                                                                                    | [`site_wall_island_test.ts`](../../../tests/site_wall_island_test.ts), [`site_design_system_runtime_test.ts`](../../../tests/site_design_system_runtime_test.ts)       |
| Data contract, cards, lenses, cluster hues                 | [`types.ts`](../../../site/wall/types.ts), [`deck.ts`](../../../site/wall/deck.ts), [`clusters.ts`](../../../site/wall/clusters.ts)                                                                                                  | [`site_wall_deck_test.ts`](../../../tests/site_wall_deck_test.ts)                                                                                                      |
| Card citations and the generated wall page                 | [`scripts/brand/wall.ts`](../../../scripts/brand/wall.ts), [`scripts/brand/docs/wall.ts`](../../../scripts/brand/docs/wall.ts)                                                                                                       | [`site_wall_deck_test.ts`](../../../tests/site_wall_deck_test.ts), [`brand_registry_codegen_test.ts`](../../../tests/brand_registry_codegen_test.ts)                   |
| A card's markup, surfaces, and states                      | [`Card.tsx`](../../../site/wall/Card.tsx), [`wall-card.css`](../../../site/page-src/wall-card.css)                                                                                                                                   | [`site_wall_card_test.ts`](../../../tests/site_wall_card_test.ts)                                                                                                      |
| The list's columns and a card's place in them              | [`wall.css`](../../../site/page-src/wall.css), [`wall-card.css`](../../../site/page-src/wall-card.css), [`wall-interactions.css`](../../../site/page-src/wall-interactions.css)                                                      | Direct browser review                                                                                                                                                  |
| The lens and receded cards                                 | [`Lens.tsx`](../../../site/wall/Lens.tsx), [`wall-interactions.css`](../../../site/page-src/wall-interactions.css)                                                                                                                   | [`site_wall_interactions_test.ts`](../../../tests/site_wall_interactions_test.ts), [`site_homepage_browser_test.ts`](../../../tests/site_homepage_browser_test.ts)     |
| The opened card                                            | [`OpenCard.tsx`](../../../site/wall/OpenCard.tsx), [`use_open_card.ts`](../../../site/wall/use_open_card.ts), [`wall-interactions.css`](../../../site/page-src/wall-interactions.css)                                                | [`site_wall_interactions_test.ts`](../../../tests/site_wall_interactions_test.ts), [`site_wall_sheet_browser_test.ts`](../../../tests/site_wall_sheet_browser_test.ts) |
| What a view transition costs                               | [`use_open_card.ts`](../../../site/wall/use_open_card.ts), [`use_light.ts`](../../../site/wall/use_light.ts), [`wall.css`](../../../site/page-src/wall.css), [`wall-interactions.css`](../../../site/page-src/wall-interactions.css) | [`site_wall_transition_test.ts`](../../../tests/site_wall_transition_test.ts)                                                                                          |
| Glyph vocabulary, drawings, renderer, and pose             | [`glyph_grammar.ts`](../../../site/wall/glyph_grammar.ts), [`glyphs.ts`](../../../site/wall/glyphs.ts), [`Glyph.tsx`](../../../site/wall/Glyph.tsx), [`wall-glyph.css`](../../../site/page-src/wall-glyph.css)                       | [`site_wall_glyph_test.ts`](../../../tests/site_wall_glyph_test.ts)                                                                                                    |
| Pointer light                                              | [`use_light.ts`](../../../site/wall/use_light.ts), [`wall.css`](../../../site/page-src/wall.css), [`wall-card.css`](../../../site/page-src/wall-card.css)                                                                            | [`site_wall_light_test.ts`](../../../tests/site_wall_light_test.ts)                                                                                                    |
| The stage, the approach, and keyboard focus                | [`use_stage.ts`](../../../site/wall/use_stage.ts), [`wall.css`](../../../site/page-src/wall.css)                                                                                                                                     | [`site_homepage_browser_test.ts`](../../../tests/site_homepage_browser_test.ts), [`site_wall_island_test.ts`](../../../tests/site_wall_island_test.ts)                 |
| Tunable values and the tuning panel                        | [`tuning/knobs.ts`](../../../site/wall/tuning/knobs.ts), [`tuning/Panel.tsx`](../../../site/wall/tuning/Panel.tsx)                                                                                                                   | [`site_wall_island_test.ts`](../../../tests/site_wall_island_test.ts), [`site_homepage_browser_test.ts`](../../../tests/site_homepage_browser_test.ts)                 |

The wall's pages name each test by its subject. The browser test is `site_homepage_browser_test.ts`, the sheet test is `site_wall_sheet_browser_test.ts` and the theme browser test is `site_homepage_theme_browser_test.ts`. The island, deck, card, glyph, interactions, light, and transition tests are the `site_wall_*_test.ts` files of those names.

`WALL_STYLESHEETS` in `assets.ts` lists the wall's stylesheets in cascade order, and the build copies each one beside the homepage's design-system bundle:

| Stylesheet                                                              | Styles                                                                                                                                                                                                                                                                                                                                               |
| ----------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [`wall.css`](../../../site/page-src/wall.css)                           | The room, the headline pool, the two actions and the copy control, the row of agents, the setup prompt, the stage and its approach, the list's columns, the lens bar's place and its two fades, the link past the cards, the face colors and the cluster accent, the light on the canvas, and the forced-colors, more-contrast, and print fallbacks. |
| [`wall-card.css`](../../../site/page-src/wall-card.css)                 | A card's place in its line of the list, card surfaces, the light on card borders, the rest, hover, focus, and pressed states, and the one-column layout.                                                                                                                                                                                             |
| [`wall-glyph.css`](../../../site/page-src/wall-glyph.css)               | Glyph tones, strokes, and the pose a lit card's glyph holds.                                                                                                                                                                                                                                                                                         |
| [`wall-interactions.css`](../../../site/page-src/wall-interactions.css) | Lens chips, the divider, receded cards, the opened card, and its transitions.                                                                                                                                                                                                                                                                        |
| [`wall-tuning.css`](../../../site/page-src/wall-tuning.css)             | The tuning panel.                                                                                                                                                                                                                                                                                                                                    |

Each kind of movement has one element. Hover transforms belong to `.wall-card-face`. The scroll approach transforms `.wall-plane`. The drawing of a glyph that travels moves on its own box. The list item `.wall-card` changes only opacity and filter, and [the list's order alone places it](wall-columns.md). Keeping them apart stops a transform in one stylesheet from replacing a transform in another.

`wall.css` declares the colors of a face once, on the page's root, where the pictures of a view transition can read them. They are the foot every face ends on, a card's head, and the sheet's lighter head. The same stylesheet works out a cluster's accent from its hue for a card, the sheet, and a chip's dot.

## The headline pool

The pool is the upright first screen of the room: a badge of three facts, the headline, the category line beneath it, the two actions, and [the row of agents](#the-row-of-agents). The headline takes the pool's whole width at every size and breaks only where it must, into lines of like length. The category line follows it. Under a wrapped headline it wraps as well and is never the wider of the two. From the width at which the pool holds the headline on one line, it takes one line too.

That width is one media query in `wall.css`, which also deepens the fade down a one-line headline. Review the headline's balance in the browser. The browser test checks usable page width at phone and laptop sizes; exact wrapping and line-length ratios are not test contracts.

The pool leads with the link into the manual. The control that copies the setup prompt stands beside it in the quiet look of a second action. In a room too narrow for the pair, the two stack at one width.

The pool's height is part of [the approach](wall-motion.md#the-approach). The pool leaving the viewport times the wall's tilt, and the far view shows in whatever the pool leaves of the first screen. Anything added to the pool pushes the far view down. The row of agents is one line on a laptop for that reason. After a change to what the pool holds, check that the far view still shows under it at 1280 by 800 and at 1440 by 900, and that a phone's first screen stays clean at 375 by 812.

## The setup prompt

The setup prompt is the instruction a visitor pastes into a coding agent to set discern up. `SETUP_PROMPT` in [`SetupPrompt.tsx`](../../../site/wall/SetupPrompt.tsx) is its one source. The island test fails if another module spells a sentence of it, or if the page carries the words twice.

The closing section shows the words as server markup, so they are there without script. One press selects them all. Under them the section leads with the copy control and keeps the link into the manual as its quiet second action.

Both copy controls need script. They are server markup, and the stylesheet hides them until the root carries `data-wall-live`. Each keeps its place while hidden, so the action beside it does not move when the control appears. A browser that runs no script gives the place up through the `scripting` media feature, and the other action is centered alone.

`useSetupPrompt` holds what the last copy came to for both controls:

- **Copied.** The control that asked shows a tick and "Copied" for a moment, then its label again. Both sets of words lie in one grid cell and the label is hidden, not removed, so the control keeps its width. The hidden label carries `aria-hidden`, which keeps it out of the control's name and out of the site prose projection.
- **Refused.** A browser refuses outside a secure page, without the visitor's leave, or by having no clipboard. One that has not answered within a second counts as refusing. The page then selects the prompt's words, gives them the focus, and brings them into view, so the visitor's next key can copy them. No control changes its label.

One status line in the closing section speaks for both controls. It is a polite `role="status"` region. It is drawn only for a refused copy, which a control cannot show on its own face. Each request clears the last outcome first, so the line speaks again when the same outcome follows itself.

The page holds two status regions: this one and [the lens's](wall-lens.md). A test or a selector that asks for a status must say which.

The moment a control goes on saying "Copied" is a timer. `useSetupPrompt` takes it from the shared `Scheduler` in [`src/shared/scheduler.ts`](../../../src/shared/scheduler.ts). A direct timer call fails lint.

The words a copy shows after script runs are `COPIED_LABEL` and `COPY_STATUS`. The rendered markup does not hold them.

A copy control goes off the page on paper. The prompt's words print on a plain outlined face.

## The row of agents

Under the pool's actions, one row names the coding agents discern works with: the words "Works with your coding agent", then one mark for each agent.

The list is the live provider registry, `PROVIDERS` in [`src/lib/providers.ts`](../../../src/lib/providers.ts), in the order of `AGENT_NAMES`. That module is server code. `HomePage.tsx` reads it and hands the island each agent's name and the address of its silhouette as the `agents` prop. A provider added to the registry joins the row with no change to the wall, and the island test holds the row to the registry.

A mark is the vendor's own file, used as a CSS mask over the room's ink. `providerBrandSilhouette` picks the form with no painted background. The files under `site/pages/assets/integrations/` are generated vendor assets with recorded provenance, and nothing recolors them. The mask's address reaches the stylesheet as the `--wall-agent-mark` custom property in the mark's inline style. The Content Security Policy in [`site/seo.tsx`](../../../site/seo.tsx) admits both: `img-src 'self'` covers the mask's file, and `style-src-attr` covers the inline property.

A mark has no words beside it. Each carries its agent's name as `aria-label` on a `role="img"` box and as its `title`, and the row's words name the list.

A mark is a background, and two settings would drop it. Forced colors repaint backgrounds as the canvas, so the mark opts out and takes the system's text color. Paper drops backgrounds, so the mark asks to keep its own with `print-color-adjust`. The theme browser test checks the marks on paper.
