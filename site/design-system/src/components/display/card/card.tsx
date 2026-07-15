import { forwardRef } from "react";
import type { HTMLAttributes, ReactNode } from "react";
import { classNames } from "../../class-names.ts";

export interface CardProps extends HTMLAttributes<HTMLDivElement> {
  readonly raised?: boolean;
  readonly texture?: "plain" | "dots";
  readonly padding?: "none" | "sm" | "md" | "lg";
  readonly children: ReactNode;
}

export const Card = forwardRef<HTMLDivElement, CardProps>(function Card(
  {
    raised = false,
    texture = "plain",
    padding = "md",
    className,
    children,
    ...props
  },
  ref,
) {
  return (
    <div
      ref={ref}
      className={classNames(
        "discern-card",
        raised && "discern-card--raised",
        texture === "dots" && "discern-card--dots",
        `discern-card--pad-${padding}`,
        className,
      )}
      {...props}
    >
      {children}
    </div>
  );
});
