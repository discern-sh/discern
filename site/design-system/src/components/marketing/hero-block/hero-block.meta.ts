import type { ComponentMeta } from "../../../types/component-meta.ts";

export default {
  name: "Hero block",
  slug: "hero-block",
  group: "Marketing",
  order: 20,
  description:
    "High-impact opening section with split and centered compositions, flexible actions, proof, and visual slots.",
  accessibility: [
    "The heading level is explicit so the block can open a page or a nested campaign.",
    "Copy, actions, and supporting visuals retain source order when the layout collapses.",
  ],
} satisfies ComponentMeta;
