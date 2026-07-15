import { forwardRef, useId } from "react";
import type { ReactNode, TextareaHTMLAttributes } from "react";
import { classNames } from "../../class-names.ts";
import { Field, fieldDescriptionId } from "../field/field.tsx";

export interface TextareaProps
  extends TextareaHTMLAttributes<HTMLTextAreaElement> {
  readonly label?: ReactNode;
  readonly hint?: ReactNode;
  readonly error?: ReactNode;
}
export const Textarea = forwardRef<HTMLTextAreaElement, TextareaProps>(
  function Textarea(
    {
      label,
      hint,
      error,
      id,
      className,
      required,
      "aria-describedby": ariaDescribedBy,
      rows = 4,
      ...props
    },
    ref,
  ) {
    const generatedId = useId();
    const controlId = id ?? generatedId;
    const describedBy =
      [ariaDescribedBy, fieldDescriptionId(controlId, hint, error)].filter(
        Boolean,
      ).join(" ") || undefined;
    const control = (
      <textarea
        ref={ref}
        id={controlId}
        rows={rows}
        required={required}
        aria-invalid={error ? true : undefined}
        aria-describedby={describedBy}
        className={classNames("discern-control", "discern-textarea", className)}
        {...props}
      />
    );
    if (!label && !hint && !error) return control;
    return (
      <Field
        controlId={controlId}
        label={label}
        hint={hint}
        error={error}
        required={required}
      >
        {control}
      </Field>
    );
  },
);
