import type { ComponentMeta } from "../../../types/component-meta.ts";

export default {
  name: "Icon",
  slug: "icon",
  group: "Core",
  order: 10,
  description:
    "Vendor-neutral sizing and accessibility wrapper for an injected icon graphic.",
  accessibility: [
    "Decorative icons are hidden automatically.",
    "Meaningful icons require a label.",
  ],
} satisfies ComponentMeta;
