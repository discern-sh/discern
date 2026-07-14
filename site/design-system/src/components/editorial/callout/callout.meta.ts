import type { ComponentMeta } from "../../../types/component-meta.ts";

export default {
  name: "Callout",
  slug: "callout",
  group: "Editorial",
  order: 70,
  description:
    "Inset editorial note for context, interpretation, cautions, and successful outcomes without breaking the reading flow.",
  accessibility: [
    "The callout is exposed as a note landmark with a real heading and never relies on colour alone for meaning.",
  ],
} satisfies ComponentMeta;
