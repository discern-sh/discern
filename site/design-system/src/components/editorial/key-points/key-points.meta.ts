import type { ComponentMeta } from "../../../types/component-meta.ts";

export default {
  name: "Key points",
  slug: "key-points",
  group: "Editorial",
  order: 50,
  description:
    "Scannable article summary that turns a small set of central ideas into a numbered editorial brief.",
  accessibility: [
    "Key ideas are an ordered list with real headings rather than a visually numbered collection of generic containers.",
  ],
} satisfies ComponentMeta;
