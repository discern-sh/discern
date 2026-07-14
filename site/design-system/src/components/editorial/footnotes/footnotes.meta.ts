import type { ComponentMeta } from "../../../types/component-meta.ts";

export default {
  name: "Footnotes",
  slug: "footnotes",
  group: "Editorial",
  order: 110,
  description:
    "End-note section for citations, qualifications, and source detail, with stable anchors and optional return links.",
  accessibility: [
    "Notes remain an ordered list with stable ids, and return links carry descriptive accessible labels.",
  ],
} satisfies ComponentMeta;
