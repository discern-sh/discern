---
aliases:
  - og image
  - open graph image
  - link preview
  - social card
---

# Social cards

Every HTML route has its own link-preview image at `/og/<route>.png`, with `/og/index.png` for the homepage. Page metadata names that address in `og:image` and `twitter:image`, with the card's size and alt text. [ADR 0423](../_adr/0423-social-cards-render-on-request-from-design-system-fonts.md) records why cards render on request from the design system's fonts.

## Where each piece lives

| Piece                                                       | Role                                                                                                                                    |
| ----------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------- |
| [`site/social/address.ts`](../../../site/social/address.ts) | Maps a route to its card address and back, holds the card size, and lists the retired static images that redirect to the homepage card. |
| [`site/social/model.ts`](../../../site/social/model.ts)     | Decides what a card says, from the brand copy, the manual and decision entries, or the release records.                                 |
| [`site/social/typeset.ts`](../../../site/social/typeset.ts) | Shapes and wraps text with the design system's fonts and draws the glyphs no font carries.                                              |
| [`site/social/draw.ts`](../../../site/social/draw.ts)       | Composes the SVG: palette, backdrop, brand lockup, and one layout per card kind.                                                        |
| [`site/social/render.ts`](../../../site/social/render.ts)   | Loads the PNG renderer and fonts once, then renders each card to a PNG kept for the process.                                            |

[`site/serve.ts`](../../../site/serve.ts) answers a card address only for a live HTML route, so an unpublished page such as `/agents` has no card until it is published.

## What a card says

A card's text depends on the kind of page it previews:

- A marketing page shows a headline and one supporting line. The homepage repeats its hero headline and the footer's category line, so editing either constant in [`site/brand.ts`](../../../site/brand.ts) changes the page and the card together.
- A document shows an eyebrow, its title, and its description. A manual page's eyebrow carries the section number and name, plus its purpose when the section name does not already say it. A decision's eyebrow carries its record number, and its title drops the `ADR NNNN:` prefix.
- The releases page shows the newest stable release, or the newest record before any release is published, with its codename, date, and summary.

## How text is set

The typesetter reads the font files the site serves from the built composition bundle. It decompresses them from WOFF2 and instances each variable face at the weight a style asks for. A character the requested face lacks falls back to Inter, then JetBrains Mono. ◮ is drawn from the canonical mark geometry and → as a stroked arrow; anything else no face carries throws `MissingGlyphError`.

A document title takes the largest size at which the title and its description both fit. When no size fits the description, the title keeps the largest size that sets it in full and the description ends in an ellipsis. Long addresses are cut at the end.

## Change the cards

Edit a layout in `draw.ts` and request the card from a local preview, for example `http://localhost:4507/og/docs/understand/proof.png`. A preview process keeps each card it has drawn, so restart the preview after an edit. Card colors name the site token they reproduce; change the token's value in the design system, not a hex value in the card.

## Guards

- [`tests/site_social_cards_test.ts`](../../../tests/site_social_cards_test.ts) lays out every live route's card and fails if a title is cut or a character cannot be drawn. It also checks card addresses, the served image's size, the retired-image redirects, and that the backdrop keeps the homepage backdrop's ring ratio.
- [`tests/site_social_cards_browser_test.ts`](../../../tests/site_social_cards_browser_test.ts) compares every card color with the value its token computes in the site's dark theme.
- [`tests/site_seo_test.ts`](../../../tests/site_seo_test.ts) and the [process smoke](publishing.md#verify-a-deploy) check that every page names its own card. The smoke also fetches one card of each kind.
