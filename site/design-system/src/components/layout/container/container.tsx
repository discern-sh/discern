import { forwardRef } from "react";
import type { HTMLAttributes, ReactNode } from "react";
import { classNames } from "../../class-names.ts";

export interface ContainerProps extends HTMLAttributes<HTMLDivElement> {
  readonly size?: "measure" | "sm" | "md" | "lg" | "full";
  readonly children: ReactNode;
}
export const Container = forwardRef<HTMLDivElement, ContainerProps>(
  function Container({ size = "lg", className, children, ...props }, ref) {
    return (
      <div
        ref={ref}
        className={classNames(
          "ds-container-box",
          `ds-container-box--${size}`,
          className,
        )}
        {...props}
      >
        {children}
      </div>
    );
  },
);
