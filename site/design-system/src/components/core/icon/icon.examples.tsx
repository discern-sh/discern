import { ExampleIcon } from "../../../fixtures/example-icon.tsx";
import { Icon } from "./icon.tsx";

export default function IconExamples() {
  return (
    <div className="discern-example-row discern-example-row--large">
      {(["spark", "arrow", "check", "info", "moon", "close"] as const).map((
        name,
      ) => (
        <Icon key={name} label={`${name} example`} size={24}>
          <ExampleIcon name={name} />
        </Icon>
      ))}
    </div>
  );
}
