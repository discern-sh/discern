import type { ComponentMeta } from "../../../types/component-meta.ts";

export default {
  name: "Timeline",
  slug: "timeline",
  group: "Editorial",
  order: 100,
  description:
    "Chronological narrative for histories, release stories, investigations, and staged programmes, with optional status and detail.",
  accessibility: [
    "Events remain an ordered list and visual marker status supplements rather than replaces the written content.",
  ],
} satisfies ComponentMeta;
