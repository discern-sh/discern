import { ExampleIcon } from "../../../fixtures/example-icon.tsx";
import { IconButton } from "./icon-button.tsx";

export default function IconButtonExamples() {
  return (
    <div className="discern-example-row">
      <IconButton icon={<ExampleIcon name="moon" />} label="Toggle theme" />
      <IconButton
        icon={<ExampleIcon name="info" />}
        label="More information"
        variant="outline"
      />
      <IconButton icon={<ExampleIcon name="close" />} label="Close" size="sm" />
      <IconButton
        icon={<ExampleIcon name="spark" />}
        label="Generate"
        size="lg"
        variant="outline"
      />
    </div>
  );
}
