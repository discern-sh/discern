import type { ComponentMeta } from "../../../types/component-meta.ts";
export default {
  name: "Field",
  slug: "field",
  group: "Forms",
  order: 10,
  description:
    "Shared label, hint, required, and error structure for custom controls.",
  accessibility: ["Labels and messages use deterministic control IDs."],
} satisfies ComponentMeta;
