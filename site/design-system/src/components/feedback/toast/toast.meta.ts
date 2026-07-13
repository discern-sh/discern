import type { ComponentMeta } from "../../../types/component-meta.ts";
export default {
  name: "Toast",
  slug: "toast",
  group: "Feedback",
  order: 20,
  description:
    "Transient status message plus a labelled live-region container.",
  accessibility: [
    "Danger uses alert semantics; other tones use status semantics.",
    "Auto-dismiss is opt-in.",
  ],
} satisfies ComponentMeta;
