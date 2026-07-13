import type { ComponentMeta } from "../../../types/component-meta.ts";
export default {
  name: "Dialog",
  slug: "dialog",
  group: "Feedback",
  order: 40,
  description:
    "Controlled native modal dialog with platform focus containment and explicit close behaviour.",
  accessibility: [
    "Uses showModal(), aria-labelledby, Escape handling, and a labelled close button.",
    "Background scrolling is locked while open.",
  ],
} satisfies ComponentMeta;
