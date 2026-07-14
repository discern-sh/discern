import type { ComponentMeta } from "../../../types/component-meta.ts";

export default {
  name: "Testimonial",
  slug: "testimonial",
  group: "Marketing",
  order: 100,
  description:
    "Editorial customer quote with attribution, optional portrait, and an adjacent measurable outcome.",
  accessibility: [
    "Quotation and attribution use blockquote and figcaption semantics.",
    "Decorative quote marks and avatars are hidden from assistive technology.",
  ],
} satisfies ComponentMeta;
