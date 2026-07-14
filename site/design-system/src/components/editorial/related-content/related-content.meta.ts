import type { ComponentMeta } from "../../../types/component-meta.ts";

export default {
  name: "Related content",
  slug: "related-content",
  group: "Editorial",
  order: 120,
  description:
    "Continuation band for related essays, guides, reports, or issues, with enough context to make each next-reading choice meaningful.",
  accessibility: [
    "Every recommendation is a headed article and its title is the primary descriptive link.",
  ],
} satisfies ComponentMeta;
