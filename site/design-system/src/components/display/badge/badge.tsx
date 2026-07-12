import { forwardRef } from "react";
import type { HTMLAttributes, ReactNode } from "react";
import { classNames } from "../../class-names.ts";

export type BadgeTone = "accent" | "neutral" | "success" | "warning" | "danger";

export interface BadgeProps extends HTMLAttributes<HTMLSpanElement> {
  readonly tone?: BadgeTone;
  readonly dot?: boolean;
  readonly children: ReactNode;
}

export const Badge = forwardRef<HTMLSpanElement, BadgeProps>(function Badge(
  { tone = "accent", dot = false, className, children, ...props },
  ref,
) {
  return (
    <span
      ref={ref}
      className={classNames("ds-badge", `ds-badge--${tone}`, className)}
      {...props}
    >
      {dot ? <span className="ds-badge__dot" aria-hidden="true" /> : null}
      {children}
    </span>
  );
});
