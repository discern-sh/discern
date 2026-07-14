import { Button } from "../../core/button/button.tsx";
import { Terminal } from "../../display/terminal/terminal.tsx";
import { SplitFeature } from "./split-feature.tsx";

export default function SplitFeatureExamples() {
  return (
    <SplitFeature
      eyebrow="From promise to proof"
      title="Put the evidence beside the claim."
      description={
        <p>
          A split composition lets explanation and product truth reinforce one
          another.
        </p>
      }
      points={[
        {
          title: "Specific",
          description: "Each point says what changed for the reader.",
        },
        {
          title: "Scannable",
          description: "The hierarchy survives a quick first pass.",
        },
        {
          title: "Composable",
          description: "Swap in any media without changing the narrative.",
        },
      ]}
      actions={<Button href="#learn">Learn how it works</Button>}
      media={
        <Terminal title="example output">
          {"$ example verify\n✓ inputs checked\n✓ result recorded\n\nready for review"}
        </Terminal>
      }
      surface="sunken"
    />
  );
}
