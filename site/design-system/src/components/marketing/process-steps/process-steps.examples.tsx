import { ProcessSteps } from "./process-steps.tsx";

export default function ProcessStepsExamples() {
  return (
    <ProcessSteps
      eyebrow="How it works"
      title="A clear path from input to outcome."
      description={
        <p>
          Use the sequence to make a new process feel understandable before the
          reader commits.
        </p>
      }
      steps={[
        {
          title: "Connect",
          description: (
            <p>
              Start with the tools and context already in place.
            </p>
          ),
          detail: "Two-minute setup",
        },
        {
          title: "Shape",
          description: (
            <p>Turn the desired outcome into a concrete, reviewable plan.</p>
          ),
          detail: "Human-readable defaults",
        },
        {
          title: "Build",
          description: (
            <p>Carry the work through with the system close at hand.</p>
          ),
          detail: "No stack lock-in",
        },
        {
          title: "Prove",
          description: (
            <p>Finish with evidence someone else can independently inspect.</p>
          ),
          detail: "Permanent receipt",
        },
      ]}
    />
  );
}
