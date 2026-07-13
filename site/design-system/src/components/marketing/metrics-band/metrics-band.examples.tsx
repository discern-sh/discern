import { MetricsBand } from "./metrics-band.tsx";

export default function MetricsBandExamples() {
  return (
    <MetricsBand
      eyebrow="Measured impact"
      title="Proof at a glance."
      tone="accent"
      items={[
        {
          value: "42%",
          label: "less rework",
          detail: "Across the first quarter",
        },
        {
          value: "3.4×",
          label: "faster review",
          detail: "From open to decision",
        },
        {
          value: "99.9%",
          label: "successful runs",
          detail: "Over the last 30 days",
        },
      ]}
    />
  );
}
