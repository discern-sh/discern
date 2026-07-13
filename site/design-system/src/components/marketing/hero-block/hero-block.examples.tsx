import { Button } from "../../core/button/button.tsx";
import { Badge } from "../../display/badge/badge.tsx";
import { Window } from "../../display/window/window.tsx";
import { HeroBlock } from "./hero-block.tsx";

export default function HeroBlockExamples() {
  return (
    <HeroBlock
      eyebrow={<Badge tone="accent" dot>New collection</Badge>}
      title={<>Make the complicated feel inevitable.</>}
      description={
        <p>
          A flexible opening composition for a clear promise, an immediate next
          step, and one memorable piece of product evidence.
        </p>
      }
      actions={
        <>
          <Button href="#start">Start exploring</Button>
          <Button href="#details" variant="secondary">See the details</Button>
        </>
      }
      meta="No account required · takes two minutes"
      visual={
        <Window title="A useful product view">
          <div style={{ padding: "2rem", minHeight: "15rem" }}>
            <strong>Flexible visual slot</strong>
            <p>Windows, diagrams, screenshots, code, or editorial artwork.</p>
          </div>
        </Window>
      }
      surface="accent"
    />
  );
}
