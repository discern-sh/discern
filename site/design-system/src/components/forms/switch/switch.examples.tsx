import { Switch } from "./switch.tsx";
export default function SwitchExamples() {
  return (
    <div className="ds-example-stack">
      <Switch
        label="Lorem ipsum"
        description="Consectetur adipiscing elit."
        defaultChecked
      />
      <Switch label="Dolor sit amet" />
    </div>
  );
}
