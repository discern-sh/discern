import type { ComponentMeta } from "../../../types/component-meta.ts";

export default {
  name: "Data figure",
  slug: "data-figure",
  group: "Editorial",
  order: 90,
  description:
    "Framed figure for charts, diagrams, annotated images, and research evidence, with legend, caption, and source slots.",
  accessibility: [
    "The caller supplies the visual's accessible representation while the surrounding title, caption, legend, and source retain figure semantics.",
    "Legend labels accompany every colour swatch so colour is never the only key.",
  ],
} satisfies ComponentMeta;
