import { forwardRef, useId } from "react";
import type { ReactNode, SelectHTMLAttributes } from "react";
import { classNames } from "../../class-names.ts";
import { Field, fieldDescriptionId } from "../field/field.tsx";

export interface SelectOption {
  readonly value: string;
  readonly label: ReactNode;
  readonly disabled?: boolean;
}
export interface SelectProps extends SelectHTMLAttributes<HTMLSelectElement> {
  readonly label?: ReactNode;
  readonly hint?: ReactNode;
  readonly error?: ReactNode;
  readonly options?: readonly SelectOption[];
}
export const Select = forwardRef<HTMLSelectElement, SelectProps>(
  function Select(
    {
      label,
      hint,
      error,
      options,
      children,
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
    const describedBy =
      [ariaDescribedBy, fieldDescriptionId(controlId, hint, error)].filter(
        Boolean,
      ).join(" ") || undefined;
    const control = (
      <span className="ds-select">
        <select
          ref={ref}
          id={controlId}
          required={required}
          aria-invalid={error ? true : undefined}
          aria-describedby={describedBy}
          className={classNames("ds-control", className)}
          {...props}
        >
          {options
            ? options.map((option) => (
              <option
                key={option.value}
                value={option.value}
                disabled={option.disabled}
              >
                {option.label}
              </option>
            ))
            : children}
        </select>
        <span className="ds-select__chevron" aria-hidden="true" />
      </span>
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
