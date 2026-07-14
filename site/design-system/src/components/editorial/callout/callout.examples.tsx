import { Callout } from "./callout.tsx";

export default function CalloutExamples() {
  return (
    <div style={{ display: "grid", gap: "1rem" }}>
      <Callout
        eyebrow="Editor’s note"
        title="Keep the exception visible."
        icon="i"
        tone="insight"
      >
        <p>Readers trust a bounded claim more than a universal one.</p>
      </Callout>
      <Callout
        eyebrow="Caution"
        title="This path changes shared state."
        icon="!"
        tone="warning"
      >
        <p>Pause at the consequence, not merely at the command.</p>
      </Callout>
    </div>
  );
}
