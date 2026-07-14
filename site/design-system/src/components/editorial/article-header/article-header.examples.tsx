import { Button } from "../../core/button/button.tsx";
import { Badge } from "../../display/badge/badge.tsx";
import { ArticleHeader } from "./article-header.tsx";

export default function ArticleHeaderExamples() {
  return (
    <ArticleHeader
      eyebrow={<Badge tone="accent">Field note · Issue 08</Badge>}
      title={<>Building a review habit that survives the busy week.</>}
      standfirst={
        <p>
          A practical editorial opener for content that needs authority, pace,
          and enough context for a reader to decide whether to commit.
        </p>
      }
      authors={[{
        name: "Morgan Lee",
        role: "Research editor",
        initials: "ML",
      }]}
      meta={["12 min read", "Updated 14 July", "Practice"]}
      actions={<Button variant="secondary" size="sm">Save article</Button>}
      surface="accent"
    />
  );
}
