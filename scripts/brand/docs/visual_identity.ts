/**
 * The visual identity as a prose-led registry module: the rules that travel
 * with the mark and the design-system contract live as typed data; the
 * narrative stays authored Markdown. `visual-identity.md` compiles from this
 * module, sourcing the mark glyph from its shared constant.
 */

import { DISCERN_MARK } from "../../../src/shared/brand.ts";
import { DISCERN_TRIANGLE_GLYPHS } from "../../../art/terminal/triangle.ts";

/** The rules that travel with the mark, in rendering order. */
export const MARK_RULES: readonly string[] = [
  `The canonical reading is **filled versus unfilled**. A glyph renders in the reader's foreground color, so light and dark readings invert with the theme. The mirror ${DISCERN_TRIANGLE_GLYPHS.upLeft} carries no distinct meaning for the same reason.`,
  "In CLI and machine-facing output, the glyph is decorative. Meaning must survive in a font that lacks the codepoint.",
  "Drawn assets such as favicons and social images use bespoke, theme-aware SVGs derived from the shape. At small sizes, the half-fill may be exaggerated so the split survives.",
];

/** What the design-system package promises the brand, in rendering order. */
export const DESIGN_SYSTEM_CONTRACT: readonly string[] = [
  "**The visual decisions live as typed design tokens:** typography, color, and spacing, with discern's blue as the identity color of the default theme.",
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
    "discern's visual language is **Editorial Engineering**: tasteful typography, artifact-forward layouts, and a modern, simple, clean, premium appearance.",
    "",
    "It is the visual counterpart of the brand voice. The verbal system leads with human meaning and proves it with authentic artifacts. The visual system gives each specimen an editorial stage and presents it with care. The exclusions in {{doc:website-brief}} stand: no generic AI imagery, robot mascots, glowing brains, abstract swarms, or simulated dashboards.",
    "",
    "### Monospace is reserved",
    "",
    "On web pages, monospaced type identifies the name `discern` and code. Code includes source, commands, file paths, and terminal output. Eyebrows, footer text, captions, and other general copy use the page's prose type. Reserving monospace keeps the signal legible: it marks the product or its code.",
    "",
    `## The mark: ${DISCERN_MARK}`,
    "",
    `The project mark is the Unicode glyph **${DISCERN_MARK}** (U+25EE, up-pointing triangle with right half black), recorded in ADR 0149.`,
    "",
    "The shape carries the name: one form split into parts you can tell apart, which is the act of discerning. The triangle also reads as a delta, the change the Gate judges.",
    "",
    "Rules that travel with the mark:",
    "",
    bullets(MARK_RULES),
    "",
    `The aspiration that ${DISCERN_MARK} becomes a recognized signal of project seriousness remains a strategic hypothesis in {{doc:claims-and-evidence}}; do not present the mark as an established public meaning.`,
    "",
    "## The design system: `discern-design-system`",
    "",
    "The Editorial Engineering aesthetic is implemented by the in-house **`discern-design-system`** package: an independently versioned library, maintained in its own repository and published on JSR as `@discern-sh/design-system` (ADR 0139). The public site consumes a pinned release, so the visual identity changes only through an explicit version update.",
    "",
    "What the package means for the brand:",
    "",
    bullets(DESIGN_SYSTEM_CONTRACT),
    "",
    "Components, tokens, the catalog, and theming seams belong to the package itself; the brand documents stay at this altitude. discern is primarily a CLI- and MCP-driven product, so frontend UI is concentrated in the public website. New visual surfaces draw on the same package and inherit its decisions.",
    "",
    "## Relationship to the verbal brand",
    "",
    "The artifact-first visual principle in {{doc:website-brief}} (decision D-021) remains the content rule for what appears on a page; this document records how those pages should look and feel. When visual and verbal choices conflict, the precedence order in {{doc:readme}} applies.",
  ].join("\n");
}
