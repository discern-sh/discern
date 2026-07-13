import { fixtureCopy } from "../../../fixtures/content.ts";
import { Textarea } from "./textarea.tsx";
export default function TextareaExamples() {
  return (
    <Textarea
      label="Lorem ipsum"
      hint={fixtureCopy.helper}
      defaultValue={fixtureCopy.paragraph}
    />
  );
}
