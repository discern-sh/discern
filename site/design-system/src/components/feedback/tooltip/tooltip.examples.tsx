import { ExampleIcon } from "../../../fixtures/example-icon.tsx";
import { IconButton } from "../../core/icon-button/icon-button.tsx";
import { Tooltip } from "./tooltip.tsx";
export default function TooltipExamples() {
  return (
    <div className="discern-example-row">
      <Tooltip label="Lorem ipsum dolor">
        <IconButton
          icon={<ExampleIcon name="info" />}
          label="Information"
          variant="outline"
        />
      </Tooltip>
      <Tooltip label="Consectetur adipiscing" placement="bottom">
        <button className="discern-text-trigger" type="button">
          Focus or hover
        </button>
      </Tooltip>
    </div>
  );
}
