import { DataFigure } from "./data-figure.tsx";

export default function DataFigureExamples() {
  return (
    <DataFigure
      eyebrow="Figure 04"
      title="Confidence grows when evidence stays close."
      legend={[
        { label: "reviewed", tone: "accent" },
        { label: "assumed", tone: "ink" },
      ]}
      visual={
        <div
          style={{
            display: "grid",
            alignItems: "end",
            gridTemplateColumns: "repeat(5, 1fr)",
            gap: "1rem",
            minHeight: "13rem",
          }}
          aria-label="Example bar chart"
        >
          {[42, 58, 49, 76, 91].map((height, index) => (
            <span
              key={index}
              style={{
                height: `${height}%`,
                background: index === 4
                  ? "var(--discern-color-accent-500)"
                  : "var(--discern-color-accent-200)",
              }}
            />
          ))}
        </div>
      }
      caption="A visual slot can hold any chart or diagram while the frame preserves editorial context."
      source="Illustrative data"
    />
  );
}
