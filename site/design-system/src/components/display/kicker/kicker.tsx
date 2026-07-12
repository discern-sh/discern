import { forwardRef } from "react";
import type { HTMLAttributes, ReactNode } from "react";
import { classNames } from "../../class-names.ts";

export interface KickerProps extends HTMLAttributes<HTMLSpanElement> {
  readonly index?: ReactNode;
  readonly children: ReactNode;
}
export const Kicker = forwardRef<HTMLSpanElement, KickerProps>(
  function Kicker({ index, className, children, ...props }, ref) {
    return (
      <span ref={ref} className={classNames("ds-kicker", className)} {...props}>
        {index ? <span className="ds-kicker__index">{index}</span> : null}
        {children}
      </span>
    );
  },
);
