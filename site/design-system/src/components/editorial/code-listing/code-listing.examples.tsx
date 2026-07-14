import { CodeListing } from "./code-listing.tsx";

const example = `const brief = {
  question: "What must remain true?",
  evidence: ["tests", "receipt"],
};

await prove(brief);`;

export default function CodeListingExamples() {
  return (
    <CodeListing
      filename="example.ts"
      language="TypeScript"
      code={example}
      highlightLines={[2, 3]}
      caption="Highlighted lines carry the decision into executable evidence."
    />
  );
}
