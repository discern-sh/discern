import { Field } from "./field.tsx";
export default function FieldExamples() {
  return (
    <div className="ds-example-grid">
      <Field
        controlId="field-example"
        label="Lorem ipsum"
        hint="Consectetur adipiscing elit."
      >
        <input id="field-example" className="ds-control" />
      </Field>
      <Field
        controlId="field-invalid"
        label="Invalid example"
        error="Lorem ipsum dolor sit amet."
      >
        <input
          id="field-invalid"
          className="ds-control"
          aria-invalid="true"
          aria-describedby="field-invalid-error"
        />
      </Field>
    </div>
  );
}
