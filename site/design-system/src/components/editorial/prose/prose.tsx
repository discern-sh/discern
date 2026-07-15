import { forwardRef } from "react";
import type { HTMLAttributes, ReactNode } from "react";
import { classNames } from "../../class-names.ts";

export interface ProseProps extends HTMLAttributes<HTMLDivElement> {
  readonly children: ReactNode;
  readonly dropCap?: boolean;
  readonly lead?: boolean;
  readonly measure?: "narrow" | "default" | "wide";
}

export const Prose = forwardRef<HTMLDivElement, ProseProps>(function Prose(
  {
    children,
    dropCap = false,
    lead = false,
    measure = "default",
    className,
    ...props
  },
  ref,
) {
  return (
    <div
      ref={ref}
      className={classNames(
        "discern-prose",
        `discern-prose--${measure}`,
        dropCap && "discern-prose--drop-cap",
        lead && "discern-prose--lead",
        className,
      )}
      {...props}
    >
      {children}
    </div>
  );
});
