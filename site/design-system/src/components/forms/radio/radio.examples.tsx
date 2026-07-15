import { Radio } from "./radio.tsx";
export default function RadioExamples() {
  return (
    <div className="discern-example-stack">
      <Radio name="example-radio" label="Lorem ipsum" defaultChecked />
      <Radio name="example-radio" label="Dolor sit amet" />
      <Radio name="example-radio" label="Consectetur adipiscing" />
    </div>
  );
}
