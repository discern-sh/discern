import type { ComponentMeta } from "../../../types/component-meta.ts";

export default {
  name: "Audience grid",
  slug: "audience-grid",
  group: "Marketing",
  order: 40,
  description:
    "Persona-led card grid for explaining one product through the outcomes different audiences care about.",
  accessibility: [
    "Audience cards use a section heading followed by independently headed articles.",
    "Decorative numerals and icons are hidden from assistive technology.",
  ],
} satisfies ComponentMeta;
