import { forwardRef, useId } from "react";
import type { InputHTMLAttributes, ReactNode } from "react";
import { classNames } from "../../class-names.ts";
import { Field, fieldDescriptionId } from "../field/field.tsx";

export interface InputProps extends InputHTMLAttributes<HTMLInputElement> {
  readonly label?: ReactNode;
  readonly hint?: ReactNode;
  readonly error?: ReactNode;
}

export const Input = forwardRef<HTMLInputElement, InputProps>(function Input(
  {
    label,
    hint,
    error,
    id,
    className,
    required,
    "aria-describedby": ariaDescribedBy,
    ...props
  },
  ref,
) {
  const generatedId = useId();
  const controlId = id ?? generatedId;
  const messageId = fieldDescriptionId(controlId, hint, error);
  const describedBy = [ariaDescribedBy, messageId].filter(Boolean).join(" ") ||
    undefined;
  const control = (
    <input
      ref={ref}
      id={controlId}
      required={required}
      aria-invalid={error ? true : undefined}
      aria-describedby={describedBy}
      className={classNames("discern-control", className)}
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
});
