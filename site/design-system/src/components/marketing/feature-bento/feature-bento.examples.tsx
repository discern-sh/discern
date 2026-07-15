import { ExampleIcon } from "../../../fixtures/example-icon.tsx";
import { FeatureBento } from "./feature-bento.tsx";

const visual = (label: string) => (
  <span
    style={{
      color: "var(--discern-color-ink-faint)",
      fontFamily: "var(--discern-font-mono)",
    }}
  >
    {label}
  </span>
);

export default function FeatureBentoExamples() {
  return (
    <FeatureBento
      eyebrow="Capabilities"
      title="Show the system, not a list of claims."
      description={
        <p>
          Give major ideas room and let supporting details fill the rhythm
          around them.
        </p>
      }
      items={[
        {
          title: "A wide product story",
          description: (
            <p>
              Pair a concise outcome with a substantial interface or diagram.
            </p>
          ),
          icon: <ExampleIcon name="spark" />,
          visual: visual("primary product visual"),
          size: "wide",
          tone: "accent",
        },
        {
          title: "A focused detail",
          description: (
            <p>Use a smaller tile for one useful supporting capability.</p>
          ),
          icon: <ExampleIcon name="check" />,
          visual: visual("focused detail"),
        },
        {
          title: "A second dimension",
          description: (
            <p>
              Tall tiles create a more editorial, less repetitive feature
              rhythm.
            </p>
          ),
          visual: visual("tall visual"),
          size: "tall",
        },
        {
          title: "A final proof point",
          description: (
            <p>Complete the composition with another compact, specific idea.</p>
          ),
          visual: visual("supporting proof"),
        },
      ]}
    />
  );
}
