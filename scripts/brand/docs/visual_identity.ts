/**
 * The visual identity as a prose-led registry module: the rules that travel
 * with the mark and the design-system contract live as typed data; the
 * narrative stays authored Markdown. `visual-identity.md` compiles from this
 * module, sourcing the mark glyph from its shared constant.
 */

import { DISCERN_MARK } from "../../../src/shared/brand.ts";
import { DISCERN_TRIANGLE_GLYPHS } from "../../../src/lib/triangle_art.ts";

/** The rules that travel with the mark, in rendering order. */
export const MARK_RULES: readonly string[] = [
  `The canonical reading is **filled versus unfilled**, never dark versus light. A glyph renders in the reader's foreground colour, so any dark/light reading inverts with the theme; for the same reason the mirror ${DISCERN_TRIANGLE_GLYPHS.upLeft} carries no distinct meaning.`,
  "In CLI and machine-facing output the glyph is decorative, never load-bearing. Output must read correctly in a font that lacks the codepoint.",
  "Drawn assets (favicon, social images) are bespoke theme-aware SVGs derived from the shape, never a rasterised glyph. At small sizes the half-fill may be exaggerated so the split survives.",
];

/** What the design-system package promises the brand, in rendering order. */
export const DESIGN_SYSTEM_CONTRACT: readonly string[] = [
  "**The visual decisions live as typed design tokens** — typography, colour, spacing — with discern's blue as the identity colour of the default theme.",
  "**Typography is self-hosted.** Fonts and textures ship with the package; public pages depend on no third-party asset host.",
  "**Pages ship as static, semantic HTML and CSS.** React is only an optional build-time adapter; the browser receives no framework runtime. The quiet, fast result is part of the premium feel.",
];

/** Render Markdown bullets. */
function bullets(items: readonly string[]): string {
  return items.map((item) => `- ${item}`).join("\n");
}

/** The whole visual-identity document, ready for the barrel to stamp. */
export function renderVisualIdentityDoc(): string {
  return [
    "# Visual identity",
    "",
    "**Status:** Canonical\\",
    "**Purpose:** Record the visual system the brand builds with, so public surfaces stay coherent with the verbal identity.",
    "",
    "## The aesthetic: Editorial Engineering",
    "",
    "discern's visual language is **Editorial Engineering**: tasteful typography, artefact-forward layouts, and a modern, simple, clean, premium appearance.",
    "",
    "It is the visual counterpart of the brand voice. The verbal system leads with human meaning and proves it with authentic artefacts; the visual system gives those artefacts an editorial stage — specimens presented with care, rather than decoration layered over them. The exclusions in {{doc:website-brief}} stand: no generic AI imagery, robot mascots, glowing brains, abstract swarms, or simulated dashboards.",
    "",
    "### Monospace is reserved",
    "",
    "On web pages, monospaced type means exactly two things: the name `discern` and code — where code includes source, commands, file paths, and terminal output alike. Eyebrows, footer text, captions, and other general copy are never set in monospace. The reservation is what keeps the signal legible — when monospace appears, it is the product or its code, nothing else.",
    "",
    `## The mark: ${DISCERN_MARK}`,
    "",
    `The project mark is the Unicode glyph **${DISCERN_MARK}** — U+25EE, up-pointing triangle with right half black — recorded in ADR 0149.`,
    "",
    "The shape carries the name: one form split into two parts you can tell apart, which is the act of discerning. The triangle also reads as a delta — a change, which is what the Gate judges.",
    "",
    "Rules that travel with the mark:",
    "",
    bullets(MARK_RULES),
    "",
    `The aspiration that ${DISCERN_MARK} becomes a recognised signal of project seriousness remains a strategic hypothesis in {{doc:claims-and-evidence}}; do not present the mark as an established public meaning.`,
    "",
    "## The design system: `discern-design-system`",
    "",
    "The Editorial Engineering aesthetic is implemented by the in-house **`discern-design-system`** package: an independently versioned library, maintained in its own repository and published on JSR as `@discern-sh/design-system` (ADR 0139). The public site consumes an exact pinned release, so the visual identity changes by deliberate version adoption, never by drift.",
    "",
    "What the package means for the brand:",
    "",
    bullets(DESIGN_SYSTEM_CONTRACT),
    "",
    "Implementation detail — components, tokens, the catalogue, theming seams — belongs to the package itself; the brand documents stay at this altitude. discern is primarily a CLI- and MCP-driven product, so frontend UI is concentrated in the public website. New visual surfaces draw on the same package rather than restating its decisions.",
    "",
    "## Relationship to the verbal brand",
    "",
    "The artefact-first visual principle in {{doc:website-brief}} (decision D-021) remains the content rule for what appears on a page; this document records how those pages should look and feel. When visual and verbal choices conflict, the precedence order in {{doc:readme}} applies.",
  ].join("\n");
}
