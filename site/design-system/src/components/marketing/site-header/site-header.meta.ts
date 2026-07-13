import type { ComponentMeta } from "../../../types/component-meta.ts";

export default {
  name: "Site header",
  slug: "site-header",
  group: "Marketing",
  order: 10,
  description:
    "Responsive landing-page masthead with optional notice, navigation, actions, and sticky positioning.",
  accessibility: [
    "Navigation has a configurable accessible label.",
    "At narrow widths links remain available in a horizontally scrollable row.",
  ],
} satisfies ComponentMeta;
