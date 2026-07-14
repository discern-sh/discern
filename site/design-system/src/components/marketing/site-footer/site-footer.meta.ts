import type { ComponentMeta } from "../../../types/component-meta.ts";

export default {
  name: "Site footer",
  slug: "site-footer",
  group: "Marketing",
  order: 140,
  description:
    "Responsive page colophon with product context, grouped navigation, legal copy, and a compact metadata rail.",
  accessibility: [
    "Grouped links sit inside a labelled footer navigation landmark.",
    "Navigation group titles preserve a useful heading outline.",
  ],
} satisfies ComponentMeta;
