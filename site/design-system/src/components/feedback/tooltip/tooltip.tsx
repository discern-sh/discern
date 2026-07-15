import { cloneElement, forwardRef, useId } from "react";
import type { HTMLAttributes, ReactElement } from "react";
import { classNames } from "../../class-names.ts";

interface TooltipChildProps {
  readonly "aria-describedby"?: string;
}
export interface TooltipProps
  extends Omit<HTMLAttributes<HTMLSpanElement>, "children"> {
  readonly label: string;
  readonly children: ReactElement<TooltipChildProps>;
  readonly placement?: "top" | "bottom";
}
export const Tooltip = forwardRef<HTMLSpanElement, TooltipProps>(
  function Tooltip(
    { label, children, placement = "top", className, ...props },
    ref,
  ) {
    const tooltipId = useId();
    const existingDescription = children.props["aria-describedby"];
    const trigger = cloneElement(children, {
      "aria-describedby": [existingDescription, tooltipId].filter(Boolean).join(
        " ",
      ),
    });
    return (
      <span
        ref={ref}
        className={classNames(
          "discern-tooltip",
          `discern-tooltip--${placement}`,
          className,
        )}
        {...props}
      >
        {trigger}
        <span id={tooltipId} role="tooltip" className="discern-tooltip__bubble">
          {label}
        </span>
      </span>
    );
  },
);
