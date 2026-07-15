import { fixtureCopy } from "../../../fixtures/content.ts";
import { Card } from "./card.tsx";
export default function CardExamples() {
  return (
    <div className="discern-example-grid">
      <Card>
        <h4>{fixtureCopy.heading}</h4>
        <p>{fixtureCopy.paragraph}</p>
      </Card>
      <Card raised texture="dots">
        <h4>Raised dotted surface</h4>
        <p>{fixtureCopy.paragraph}</p>
      </Card>
    </div>
  );
}
