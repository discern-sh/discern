import { forwardRef, useId } from "react";
import type { InputHTMLAttributes, ReactNode } from "react";
import { classNames } from "../../class-names.ts";

export interface RadioProps
  extends Omit<InputHTMLAttributes<HTMLInputElement>, "type"> {
  readonly label: ReactNode;
  readonly description?: ReactNode;
}
export const Radio = forwardRef<HTMLInputElement, RadioProps>(
  function Radio(
    {
      label,
      description,
      id,
      className,
      "aria-describedby": ariaDescribedBy,
      ...props
    },
    ref,
  ) {
    const generatedId = useId();
    const controlId = id ?? generatedId;
    const descriptionId = description ? `${controlId}-description` : undefined;
    const describedBy =
      [ariaDescribedBy, descriptionId].filter(Boolean).join(" ") || undefined;
    return (
      <div
        className={classNames(
          "discern-choice",
          "discern-choice--radio",
          className,
        )}
      >
        <label className="discern-choice__label" htmlFor={controlId}>
          <input
            ref={ref}
            id={controlId}
            type="radio"
            aria-describedby={describedBy}
            {...props}
          />
          <span className="discern-choice__control" aria-hidden="true">
            <span />
          </span>
          <span>{label}</span>
        </label>
        {description
          ? (
            <span className="discern-choice__description" id={descriptionId}>
              {description}
            </span>
          )
          : null}
      </div>
    );
  },
);
