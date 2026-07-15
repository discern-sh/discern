import { Field } from "./field.tsx";
export default function FieldExamples() {
  return (
    <div className="discern-example-grid">
      <Field
        controlId="field-example"
        label="Lorem ipsum"
        hint="Consectetur adipiscing elit."
      >
        <input id="field-example" className="discern-control" />
      </Field>
      <Field
        controlId="field-invalid"
        label="Invalid example"
        error="Lorem ipsum dolor sit amet."
      >
        <input
          id="field-invalid"
          className="discern-control"
          aria-invalid="true"
          aria-describedby="field-invalid-error"
        />
      </Field>
    </div>
  );
}
