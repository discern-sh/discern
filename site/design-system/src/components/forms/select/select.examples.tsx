import { Select } from "./select.tsx";
export default function SelectExamples() {
  return (
    <Select
      label="Lorem ipsum"
      defaultValue="one"
      options={[{ value: "one", label: "Dolor sit amet" }, {
        value: "two",
        label: "Consectetur adipiscing",
      }, { value: "three", label: "Integer posuere" }]}
    />
  );
}
