import { ExampleIcon } from "../../../fixtures/example-icon.tsx";
import { fixtureCopy } from "../../../fixtures/content.ts";
import { Button } from "./button.tsx";

export default function ButtonExamples() {
  return (
    <div className="ds-example-stack">
      <div className="ds-example-row">
        <Button leadingIcon={<ExampleIcon name="spark" />}>
          {fixtureCopy.shortLabel}
        </Button>
        <Button variant="secondary">Secondary</Button>
        <Button variant="ghost" trailingIcon={<ExampleIcon name="arrow" />}>
          Tertiary
        </Button>
        <Button variant="danger">Danger</Button>
      </div>
      <div className="ds-example-row">
        <Button size="sm">Small</Button>
        <Button size="lg">Large</Button>
        <Button disabled>Disabled</Button>
        <Button href="#button">Anchor action</Button>
      </div>
    </div>
  );
}
