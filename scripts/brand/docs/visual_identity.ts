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

/** The exchanges carried by the triangle's edges, in reading order. */
export const TRIANGLE_RELATIONSHIPS: readonly string[] = [
  "**Human ↔ agent:** direction and delegation.",
  "**Agent ↔ project:** inheritance, implementation, and verification.",
  "**Project ↔ human:** memory, evidence, and authority.",
];

/** The rules that keep the recursive triangle meaningful. */
export const RECURSIVE_TRIANGLE_RULES: readonly string[] = [
  `The ${DISCERN_MARK} glyph remains the primary everyday mark. The recursive form extends it and never replaces it.`,
  "Reserve the Sierpiński triangle for manifesto art, motion, relational diagrams, major brand moments, and occasional details that reward recognition.",
  "Treat it as ceremonial. Keep it out of ambient backgrounds, generic imagery of AI complexity, and automatic decoration.",
  "Tie each appearance to a real relationship, recursive practice, or boundary. A reader never needs to decode it to understand the surface.",
  "Authentic project artifacts remain the primary visual language on product pages.",
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
    "### Human, agent, and project",
    "",
    "discern's triangle holds a relationship among **the human, the agent, and the project**.",
    "",
    "At the scale of the emblem, the filled and unfilled parts show human and agent as the visible duality. The enclosing triangle is the project holding their work together. Its integrity turns two distinguishable participants into one connected practice.",
    "",
    "At the scale of a relational diagram, the participants occupy its vertices and the edges carry their exchanges:",
    "",
    bullets(TRIANGLE_RELATIONSHIPS),
    "",
    "Authority remains asymmetric: the human grants it, the project records its boundary, and the agent acts within it.",
    "",
    "A unit of work receives human intent, moves through an agent, enters the project, and returns with evidence for a human decision. When work divides into smaller tasks or moves in parallel, each unit carries the same relationship.",
    "",
    "The project carries human judgment into each task, allowing it to influence implementation the human never personally inspects.",
    "",
    "Internally, discern calls this relation a **trinity**. The metaphysical weight of the word is intentional. Most public work names the participants and their relationship; founder-led and manifesto work may reveal the trinity as a personal interpretation.",
    "",
    "### The recursive triangle",
    "",
    "The Sierpiński triangle is the extended symbol of this continuous practice. Its self-similarity expresses a comprehensible rule that survives larger ambitions, smaller tasks, and parallel work. Its open spaces make distinctions and boundaries visible while the figure stays connected. This resonates with isolated worktrees held within a shared project.",
    "",
    "Rules for the extended form:",
    "",
    bullets(RECURSIVE_TRIANGLE_RULES),
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
