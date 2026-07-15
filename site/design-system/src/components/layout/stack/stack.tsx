import { forwardRef } from "react";
import type { CSSProperties, HTMLAttributes, ReactNode } from "react";
import { classNames } from "../../class-names.ts";
import { spaceValue } from "../space.ts";
import type { SpaceStep } from "../space.ts";
type StackStyle = CSSProperties & { readonly "--discern-stack-gap"?: string };
export interface StackProps extends HTMLAttributes<HTMLDivElement> {
  readonly gap?: SpaceStep;
  readonly align?: "start" | "center" | "end" | "stretch";
  readonly children: ReactNode;
}
export const Stack = forwardRef<HTMLDivElement, StackProps>(
  function Stack(
    { gap = 4, align = "stretch", className, style, children, ...props },
    ref,
  ) {
    const stackStyle: StackStyle = {
      "--discern-stack-gap": spaceValue(gap),
      ...style,
    };
    return (
      <div
        ref={ref}
        className={classNames(
          "discern-stack",
          `discern-stack--${align}`,
          className,
        )}
        style={stackStyle}
        {...props}
      >
        {children}
      </div>
    );
  },
);
