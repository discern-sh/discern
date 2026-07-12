import type { ComponentMeta } from "../../../types/component-meta.ts";
export default {
  name: "Tabs",
  slug: "tabs",
  group: "Navigation",
  order: 10,
  description:
    "Controlled or uncontrolled tab set with roving focus and complete horizontal keyboard navigation.",
  accessibility: [
    "Arrow keys, Home, End, Enter, and Space follow the ARIA tabs pattern.",
    "Tabs and panels have deterministic labelled relationships.",
  ],
} satisfies ComponentMeta;
