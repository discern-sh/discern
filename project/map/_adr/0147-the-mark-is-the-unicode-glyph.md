# ADR 0147: The project mark is the Unicode glyph ◮

**Status**: accepted

## Context

discern lives in text: a CLI, generated Markdown, MCP output, and a docs site
rendered from the same tree. Most surfaces where a mark could appear are plain
text in someone else's font, so an image-first logo would be absent from the
places the project is most often seen. The docs site already uses ◮ as the
ornament on rendered thematic breaks, and the map described it as "discern's
intended mark" — an intent no record had fixed.

## Decision

The project mark is the character ◮ — U+25EE, UP-POINTING TRIANGLE WITH RIGHT
HALF BLACK.

The shape carries the name: one form split into two parts you can tell apart,
which is the act of discerning. The triangle also reads as a delta, a change,
which is what the gate judges.

The canonical reading is **filled versus unfilled**, never dark versus light. A
glyph renders in the reader's foreground color, so on a dark theme the "black"
half is the bright one; any reading that depends on which half is dark inverts
when the theme does. For the same reason the mirror ◭ (U+25ED, left half black)
carries no distinct meaning: the two are semantically equivalent, and ◮ was
chosen on appearance.

Practical properties, checked against the Unicode character data for U+25EE:

- East Asian Width is Neutral, so terminals render it single-width even under
  CJK ambiguous-width settings; it cannot misalign columns.
- It has no emoji presentation, so no platform substitutes a colored pictograph.

Two rules bound its use:

- In CLI and machine-facing output the glyph is decorative, never load-bearing.
  Nothing parses it, no alignment depends on it, and output must read correctly
  in a font that lacks the codepoint.
- Drawn assets (favicon, social images) are authored SVGs derived from the
  shape, rendered theme-aware (`currentColor` or a light/dark pair), never a
  rasterized glyph. At favicon sizes the half-fill tends to collapse into a
  solid triangle, so drawn versions may exaggerate the split.

## Consequences

- One character serves every text surface (the README, CLI banners, the docs
  site, chat) with no asset pipeline, and theme adaptation costs nothing because
  the glyph rides the foreground color.
- Font coverage of U+25EE is wide but not universal; the decorative-only rule is
  what makes a missing-glyph box harmless.
- The site's thematic-break ornament (pinned by `tests/site_docs_test.ts`) is
  now the recorded mark rather than an unrecorded intention.

## Alternatives considered

- **◭ (U+25ED), the mirror.** A left-to-right dark-into-light reading was
  attractive, but it does not survive foreground-color inversion, so no stable
  meaning separates the mirrors. Appearance settled the choice.
- **A solid ▲ (U+25B2).** Loses the split that carries the meaning, and an
  up-pointing solid triangle is already Vercel's mark; wearing an adjacent shape
  in the same developer-tool space invites misreading.
- **An image-first logo.** Cannot travel through terminals, plain-text READMEs,
  or MCP output — the surfaces where discern is most read. Drawn assets remain,
  but as derivatives of the glyph rather than the primary mark.
