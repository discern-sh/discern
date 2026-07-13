import { fixtureCopy } from "../../../fixtures/content.ts";
import { Input } from "./input.tsx";
export default function InputExamples() {
  return (
    <div className="ds-example-grid">
      <Input
        label="Lorem ipsum"
        placeholder="Dolor sit amet"
        hint={fixtureCopy.helper}
      />
      <Input
        label="Invalid field"
        defaultValue="Lorem"
        error="Consectetur adipiscing elit."
      />
    </div>
  );
}
