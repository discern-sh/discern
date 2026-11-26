---
aliases:
  - wall guards
---

# The wall's guards

Part of [the homepage wall](the-homepage-wall.md).

## Testing scope

The wall tests protect core functionality and behavior. Preserve the page's visual character through direct review of rendered examples. Typography, exact pixel alignment, decorative geometry, and frame timing are not release requirements. Use representative phone and laptop journeys; do not multiply them into a rendering matrix for every browser or viewport.

A new assertion needs a meaningful failure it can catch. Reuse an existing journey where possible, and correct or remove tests that constrain incidental markup or CSS. A change may need no new test when existing coverage or recorded manual verification is sufficient. A missing test for an effect is not itself unfinished product work.

## Coverage

- [`site_homepage_browser_test.ts`](../../../tests/site_homepage_browser_test.ts) covers readable server markup, manual navigation without script, hydration, a lens changing and clearing, the lens strip bringing a chosen chip into view, reduced motion, keyboard access, a copy of the setup prompt that works and one the browser refuses, and the requested tuning panel. One development React journey catches hydration warnings that the production runtime omits. Phone and laptop journeys check usable page width.
- [`site_wall_sheet_browser_test.ts`](../../../tests/site_wall_sheet_browser_test.ts) covers the named dialog, dismissal controls, focus return, a press near a card's visible corner, double clicks, a quick Escape, a refused transition, a manual link, and reachable Close on a short screen. It uses ordinary interactions rather than frozen animation frames.
- [`site_wall_card_test.ts`](../../../tests/site_wall_card_test.ts) checks each card's readable content and accessible heading, decorative glyphs, receded content, and bounded pointer coordinates.
- [`site_wall_interactions_test.ts`](../../../tests/site_wall_interactions_test.ts) checks dialog content and link labels, lens groups and status, the lens strip's edges, reveal, and steps, transition choices and refusal classification, plain clicks, and readable contrast for receded cards.
- [`site_wall_island_test.ts`](../../../tests/site_wall_island_test.ts) checks the server-to-browser props and render, manual labels, the row of agents against the provider registry, the setup prompt's one source, knob defaults, bundle identity and caching, and the boundary that keeps React off other routes. [`site_design_system_runtime_test.ts`](../../../tests/site_design_system_runtime_test.ts) checks that boundary in the production server's module graph too.
- [`site_wall_transition_test.ts`](../../../tests/site_wall_transition_test.ts) checks that transitions use the shared lifecycle. [`site_wall_light_test.ts`](../../../tests/site_wall_light_test.ts) checks the light's pure arithmetic and reduced-motion decisions.
- [`site_wall_deck_test.ts`](../../../tests/site_wall_deck_test.ts) checks the card data, citations, feature references, lenses, and inventory-backed numerals. [`brand_registry_codegen_test.ts`](../../../tests/brand_registry_codegen_test.ts) keeps the generated wall reference current.
- [`site_wall_glyph_test.ts`](../../../tests/site_wall_glyph_test.ts) checks valid glyph data, a pose for every authored glyph within the grammar's bounds, the cost contract of the pose stylesheet, deterministic rendering, decorative accessibility, primitive serialization, and reduced motion.
- [`site_theme_test.ts`](../../../tests/site_theme_test.ts) and [`site_homepage_theme_browser_test.ts`](../../../tests/site_homepage_theme_browser_test.ts) check the fixed dark homepage, preservation of the reader's stored choice, and readable print colors, the agents' marks included.
- Shared [accessibility](../../../tests/site_accessibility_test.ts), [homepage scaffold](../../../tests/site_homepage_scaffold_test.ts), [prose](../../../tests/site_prose_test.ts), and [UI boundary](../../../tests/site_ui_test.ts) checks also cover the homepage.

## Shared helpers and browser review

[`site_wall_browser.ts`](../../../tests/site_wall_browser.ts) supplies the production handler, fault capture, representative viewports, and waits for completed interactions. [`wall_stylesheets.ts`](../../../tests/wall_stylesheets.ts) supplies the CSS parser used for contrast and reduced-motion checks.

Before launch, review ordinary journeys in Safari and Firefox: visible cards, working lenses and links, card opening and closing, usable focus, and a narrow layout. Accept supported flat and reduced-motion fallbacks. Record conspicuous regressions; do not turn browser-specific paint details into permanent automated constraints.

For approach changes, scroll down until the wall is flat, then back up across the start of the tilt. Repeat at a slow and an ordinary scrolling pace. The haze and horizon should return smoothly, without a flash over the cards. Check that the distant view retains both effects. This visual review guards the atmosphere's transparent fallback without adding screenshot or frame-timing assertions.
