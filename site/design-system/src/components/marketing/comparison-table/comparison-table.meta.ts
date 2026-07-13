import type { ComponentMeta } from "../../../types/component-meta.ts";

export default {
  name: "Comparison table",
  slug: "comparison-table",
  group: "Marketing",
  order: 90,
  description:
    "Three-column capability comparison with an emphasized recommendation and card-like mobile rows.",
  accessibility: [
    "Column and row headers preserve table relationships for assistive technology.",
    "Mobile labels are derived from the same column names rather than duplicated visually.",
  ],
} satisfies ComponentMeta;
