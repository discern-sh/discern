import type { ComponentMeta } from "../../../types/component-meta.ts";

export default {
  name: "Split feature",
  slug: "split-feature",
  group: "Marketing",
  order: 60,
  description:
    "Alternating editorial feature section with narrative copy, proof points, actions, and an unconstrained media slot.",
  accessibility: [
    "Content precedes media in source order even when the visual position is reversed.",
    "Proof points are expressed as a semantic list.",
  ],
} satisfies ComponentMeta;
