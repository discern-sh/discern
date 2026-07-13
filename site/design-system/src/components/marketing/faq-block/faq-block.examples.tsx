import { Button } from "../../core/button/button.tsx";
import { FaqBlock } from "./faq-block.tsx";

export default function FaqBlockExamples() {
  return (
    <FaqBlock
      eyebrow="Questions, answered"
      title="The details people need before they commit."
      description={
        <p>
          Use plain answers to remove uncertainty without interrupting the main
          story.
        </p>
      }
      aside={
        <Button href="#contact" variant="secondary" size="sm">
          Ask another question
        </Button>
      }
      openFirst
      items={[
        {
          question: "Can this fit around our existing tools?",
          answer: (
            <p>
              Yes. The block is designed for systems that add a coherent layer
              without replacing the underlying stack.
            </p>
          ),
        },
        {
          question: "How quickly can a team get started?",
          answer: (
            <p>
              Start with one workflow, prove the value, and broaden the pattern
              only when the first path is understood.
            </p>
          ),
        },
        {
          question: "What happens when our process changes?",
          answer: (
            <p>
              The source remains explicit and versioned, so the system can
              evolve with the work rather than becoming hidden convention.
            </p>
          ),
        },
        {
          question: "Does it work without client-side JavaScript?",
          answer: (
            <p>
              Yes. Native disclosure semantics keep this section useful in a
              fully static page.
            </p>
          ),
        },
      ]}
    />
  );
}
