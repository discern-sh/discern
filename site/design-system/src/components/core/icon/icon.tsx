import { forwardRef } from "react";
import type { HTMLAttributes, ReactNode } from "react";
import { classNames } from "../../class-names.ts";

export interface IconProps
  extends Omit<HTMLAttributes<HTMLSpanElement>, "children"> {
  readonly children: ReactNode;
  readonly label?: string;
  readonly size?: number | string;
}

export const Icon = forwardRef<HTMLSpanElement, IconProps>(function Icon(
  { children, label, size = "1em", className, style, ...props },
  ref,
) {
  const accessibility = label
    ? { role: "img", "aria-label": label }
    : { "aria-hidden": true as const };
  return (
    <span
      ref={ref}
      className={classNames("discern-icon", className)}
      style={{ width: size, height: size, ...style }}
      {...accessibility}
      {...props}
    >
      {children}
    </span>
  );
});
