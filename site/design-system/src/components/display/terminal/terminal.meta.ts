import type { ComponentMeta } from "../../../types/component-meta.ts";

export default {
  name: "Terminal",
  slug: "terminal",
  group: "Display",
  order: 80,
  description: "Framed monospace surface for commands and terminal output.",
  accessibility: [
    "Output preserves whitespace and scrolls horizontally instead of wrapping long lines.",
    "Provide a concise title when the terminal output needs additional context.",
  ],
} satisfies ComponentMeta;
