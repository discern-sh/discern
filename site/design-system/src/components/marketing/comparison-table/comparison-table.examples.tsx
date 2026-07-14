import { ComparisonTable } from "./comparison-table.tsx";

export default function ComparisonTableExamples() {
  return (
    <ComparisonTable
      eyebrow="Compare approaches"
      title="Make the trade-off visible."
      description={
        <p>
          A good comparison clarifies the decision without turning every row
          into a sales claim.
        </p>
      }
      firstLabel="Patchwork"
      secondLabel="A coherent system"
      secondBadge="Recommended"
      rows={[
        {
          feature: "Setup",
          first: "Recreated for each project",
          second: "One repeatable starting point",
        },
        {
          feature: "Review",
          first: "Context gathered by hand",
          second: "Evidence travels with the work",
        },
        {
          feature: "Quality",
          first: "Depends on memory",
          second: "Standards hold automatically",
        },
        {
          feature: "Portability",
          first: "Tied to one workflow",
          second: "Works across stacks and tools",
        },
      ]}
    />
  );
}
