import type { ComponentMeta } from "../../../types/component-meta.ts";

export default {
  name: "FAQ block",
  slug: "faq-block",
  group: "Marketing",
  order: 120,
  description:
    "Editorial frequently-asked-questions section using native disclosure controls and a sticky introduction.",
  accessibility: [
    "Questions use native details and summary elements, so disclosure works without JavaScript.",
    "Keyboard focus receives a visible accent outline.",
  ],
} satisfies ComponentMeta;
