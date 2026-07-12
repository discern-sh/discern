import type { ComponentMeta } from "../../../types/component-meta.ts";

export default {
  name: "Icon button",
  slug: "icon-button",
  group: "Core",
  order: 30,
  description:
    "Square icon action with a required accessible label and injected graphic.",
  accessibility: [
    "A text label is required even when only an icon is visible.",
  ],
} satisfies ComponentMeta;
