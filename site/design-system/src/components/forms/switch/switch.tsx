import { forwardRef, useId } from "react";
import type { InputHTMLAttributes, ReactNode } from "react";
import { classNames } from "../../class-names.ts";

export interface SwitchProps
  extends Omit<InputHTMLAttributes<HTMLInputElement>, "type" | "role"> {
  readonly label: ReactNode;
  readonly description?: ReactNode;
}
export const Switch = forwardRef<HTMLInputElement, SwitchProps>(
  function Switch(
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
      <div className={classNames("discern-switch", className)}>
        <label className="discern-switch__label" htmlFor={controlId}>
          <span>
            <span className="discern-switch__text">{label}</span>
            {description
              ? (
                <span
                  className="discern-switch__description"
                  id={descriptionId}
                >
                  {description}
                </span>
              )
              : null}
          </span>
          <input
            ref={ref}
            id={controlId}
            type="checkbox"
            role="switch"
            aria-describedby={describedBy}
            {...props}
          />
          <span className="discern-switch__track" aria-hidden="true">
            <span />
          </span>
        </label>
      </div>
    );
  },
);
