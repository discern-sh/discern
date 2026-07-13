import type { ComponentMeta } from "../../../types/component-meta.ts";
export default {
  name: "Tooltip",
  slug: "tooltip",
  group: "Feedback",
  order: 30,
  description:
    "Hover and focus tooltip that connects its bubble through aria-describedby.",
  accessibility: [
    "The trigger must remain independently focusable when it represents an action.",
  ],
} satisfies ComponentMeta;
