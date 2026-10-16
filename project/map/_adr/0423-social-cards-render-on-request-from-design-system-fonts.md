# ADR 0423: Social cards render on request from the design system's fonts

**Status**: accepted

## Context

A link preview shows a page's image before anyone opens it, and X now shows the image without the page title. One static card served every page, so a shared manual page or decision record previewed as the homepage. That card had also fallen behind the site's typefaces, palette, and copy.

The site has 464 HTML routes, and 412 of them are decision records. Deno Deploy runs the site build without a browser, so a card renderer cannot depend on one. The design system ships its typefaces as variable WOFF2 subsets, which common layout libraries for social images cannot read.

## Decision

Every HTML route has its own card at `/og/<route>.png`, and page metadata names it. The handler draws a card on the first request for its route and keeps the image for the life of the process. Only a live route has a card. The two retired static images redirect to the homepage card.

Card text comes from the authority that already describes the page. Marketing pages use brand copy, documents use their manual or decision entries, and `/releases` uses the release records.

The renderer decompresses the design system's own font files from the built composition bundle. It shapes text with `fontkit` at the site's weights and OpenType features and draws the glyph outlines into SVG. Then `resvg-wasm` encodes that SVG as an image. The renderer draws ◮ and → as vectors because the subset fonts lack them. Any other missing character fails the card instead of drawing a blank.

Each card color names the site token it reproduces. A browser test compares every color with the value the site's dark theme computes, so a token change cannot leave cards behind silently.

## Alternatives considered

- **Render every card at build time.** Each deployment would write and upload an image for all 464 routes, most of them decision records that people rarely share. Rendering on request draws only the cards someone asks for.
- **Lay out cards with a library built for social images.** Such libraries read static TrueType fonts, so the site would need its own static copies of each weight. Those copies would drift from the design system's fonts, and the cards would lose the stylistic sets the site's headlines use.
- **Commit images rendered in a browser.** Every title edit would churn binary files in Git, and regenerating them would need a browser that the deployment build does not have.
- **Keep one static card and refresh its design.** Deep links into the manual and decisions would still preview as the homepage.

## Consequences

Shared links preview the page they point to, in the site's current style, with no per-page authoring. A new page, section, or decision gets a card automatically. A guard lays out every live route's card to prove its title fits in full.

The first card a process draws loads the image encoder and fonts in about a quarter of a second. Later cards take about 30 milliseconds each. The site gains three dependencies: `fontkit`, `woff2-encoder`, and `resvg-wasm`.

Cards follow the design system's fonts and tokens, but their layout constants live in the site. A redesign of the homepage hero therefore needs a matching change to the card templates. Light-theme cards do not exist: a preview is one image, and the site's first impression is the dark theme.
