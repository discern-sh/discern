import type { ComponentMeta } from "../../../types/component-meta.ts";

export default {
  name: "Table of contents",
  slug: "table-of-contents",
  group: "Editorial",
  order: 30,
  description:
    "Compact numbered article navigation with an optional reading-progress note and a clear current-location state.",
  accessibility: [
    "The component is a labelled navigation landmark and exposes the current location with aria-current.",
  ],
} satisfies ComponentMeta;
