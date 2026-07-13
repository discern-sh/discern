import { Checkbox } from "./checkbox.tsx";
export default function CheckboxExamples() {
  return (
    <div className="ds-example-stack">
      <Checkbox
        label="Lorem ipsum dolor"
        description="Consectetur adipiscing elit."
        defaultChecked
      />
      <Checkbox label="Integer posuere erat" />
      <Checkbox label="Disabled option" disabled />
    </div>
  );
}
