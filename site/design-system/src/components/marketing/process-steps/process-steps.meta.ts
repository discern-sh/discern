import type { ComponentMeta } from "../../../types/component-meta.ts";

export default {
  name: "Process steps",
  slug: "process-steps",
  group: "Marketing",
  order: 70,
  description:
    "Numbered horizontal or vertical journey for onboarding, workflow, implementation, or methodology stories.",
  accessibility: [
    "Steps are an ordered list, so sequence remains explicit without the visual connectors.",
  ],
} satisfies ComponentMeta;
