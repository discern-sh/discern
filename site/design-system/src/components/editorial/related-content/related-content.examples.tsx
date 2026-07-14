import { RelatedContent } from "./related-content.tsx";

export default function RelatedContentExamples() {
  return (
    <RelatedContent
      eyebrow="Continue reading"
      title="The next useful question."
      items={[
        {
          eyebrow: "Essay",
          title: "Designing for legibility",
          description: (
            <p>
              How structure turns complexity into something a reader can
              challenge.
            </p>
          ),
          href: "#legibility",
          meta: "9 min",
        },
        {
          eyebrow: "Guide",
          title: "A practical evidence habit",
          description: (
            <p>Small techniques for keeping claims close to their proof.</p>
          ),
          href: "#evidence",
          meta: "14 min",
        },
        {
          eyebrow: "Field note",
          title: "When the system bends",
          description: (
            <p>What exceptions reveal about the boundary you actually need.</p>
          ),
          href: "#exceptions",
          meta: "6 min",
        },
      ]}
    />
  );
}
