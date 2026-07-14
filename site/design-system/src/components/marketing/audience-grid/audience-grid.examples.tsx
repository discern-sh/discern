import { ExampleIcon } from "../../../fixtures/example-icon.tsx";
import { AudienceGrid } from "./audience-grid.tsx";

export default function AudienceGridExamples() {
  return (
    <AudienceGrid
      eyebrow="Choose your path"
      title="One system, three useful points of view."
      description={
        <p>Start with the outcome that matches the work in front of you.</p>
      }
      items={[
        {
          icon: <ExampleIcon name="spark" />,
          eyebrow: "For builders",
          title: "Move from idea to reliable release.",
          description: (
            <p>
              Compose the pieces you need without giving up a coherent system.
            </p>
          ),
          href: "#builders",
          linkLabel: "Explore the builder path",
          featured: true,
        },
        {
          icon: <ExampleIcon name="check" />,
          eyebrow: "For reviewers",
          title: "See the evidence behind the result.",
          description: (
            <p>
              Turn invisible implementation detail into a reviewable account.
            </p>
          ),
          href: "#reviewers",
          linkLabel: "Explore the reviewer path",
        },
        {
          icon: <ExampleIcon name="arrow" />,
          eyebrow: "For teams",
          title: "Give every project the same strong defaults.",
          description: (
            <p>
              Share a standard without forcing every team into the same stack.
            </p>
          ),
          href: "#teams",
          linkLabel: "Explore the team path",
        },
      ]}
    />
  );
}
