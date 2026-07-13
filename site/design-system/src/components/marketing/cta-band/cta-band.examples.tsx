import { Button } from "../../core/button/button.tsx";
import { CtaBand } from "./cta-band.tsx";

export default function CtaBandExamples() {
  return (
    <CtaBand
      eyebrow="Ready when you are"
      title="Turn the next project into the new standard."
      description={
        <p>
          Begin with one useful path today, then let the system grow only where
          it earns the space.
        </p>
      }
      actions={
        <>
          <Button href="#start" size="lg">Start now</Button>
          <Button href="#talk" size="lg" variant="secondary">
            Talk it through
          </Button>
        </>
      }
      note="No credit card · no migration project · leave whenever you like"
    />
  );
}
