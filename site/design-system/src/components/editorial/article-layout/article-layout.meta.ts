import type { ComponentMeta } from "../../../types/component-meta.ts";

export default {
  name: "Article layout",
  slug: "article-layout",
  group: "Editorial",
  order: 20,
  description:
    "Responsive long-form reading shell with optional navigation and contextual rail around a primary article column.",
  accessibility: [
    "The primary reading stream is an article; optional rails are labelled complementary landmarks.",
    "Source order keeps navigation, article, and supporting context understandable without the visual grid.",
  ],
} satisfies ComponentMeta;
