import type { ComponentMeta } from "../../../types/component-meta.ts";

export default {
  name: "Feature bento",
  slug: "feature-bento",
  group: "Marketing",
  order: 50,
  description:
    "Dense asymmetric feature grid with intentional size, surface, icon, and visual slots.",
  accessibility: [
    "The visual grid preserves a simple article sequence in source order.",
    "Icons are decorative; each feature carries a visible heading and description.",
  ],
} satisfies ComponentMeta;
