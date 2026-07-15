import { forwardRef } from "react";
import type { CSSProperties, HTMLAttributes, ReactNode } from "react";
import { classNames } from "../../class-names.ts";
import { spaceValue } from "../space.ts";
import type { SpaceStep } from "../space.ts";
type GridStyle = CSSProperties & {
  readonly "--discern-grid-gap"?: string;
  readonly "--discern-grid-min"?: string;
};
export interface GridProps extends HTMLAttributes<HTMLDivElement> {
  readonly gap?: SpaceStep;
  readonly minimum?: string;
  readonly children: ReactNode;
}
export const Grid = forwardRef<HTMLDivElement, GridProps>(
  function Grid(
    { gap = 5, minimum = "14rem", className, style, children, ...props },
    ref,
  ) {
    const gridStyle: GridStyle = {
      "--discern-grid-gap": spaceValue(gap),
      "--discern-grid-min": minimum,
      ...style,
    };
    return (
      <div
        ref={ref}
        className={classNames("discern-grid", className)}
        style={gridStyle}
        {...props}
      >
        {children}
      </div>
    );
  },
);
