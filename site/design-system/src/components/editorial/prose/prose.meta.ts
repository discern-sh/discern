import type { ComponentMeta } from "../../../types/component-meta.ts";

export default {
  name: "Prose",
  slug: "prose",
  group: "Editorial",
  order: 40,
  description:
    "Long-form typographic context for headings, paragraphs, lists, links, inline code, rules, and optional lead or drop-cap treatments.",
  accessibility: [
    "The adapter adds no document hierarchy; authors keep full control of semantic headings and content order.",
    "Readable measure and generous line height persist across all variants.",
  ],
} satisfies ComponentMeta;
