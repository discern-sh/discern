import { fixtureCopy } from "../../../fixtures/content.ts";
import { Tabs } from "./tabs.tsx";
export default function TabsExamples() {
  return (
    <Tabs
      label="Example sections"
      items={[{
        value: "one",
        label: "Lorem",
        content: <p>{fixtureCopy.paragraph}</p>,
      }, {
        value: "two",
        label: "Ipsum",
        content: <p>{fixtureCopy.paragraphLong}</p>,
      }, { value: "three", label: "Disabled", content: null, disabled: true }]}
    />
  );
}
