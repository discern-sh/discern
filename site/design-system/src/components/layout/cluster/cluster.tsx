import { forwardRef } from "react";
import type { CSSProperties, HTMLAttributes, ReactNode } from "react";
import { classNames } from "../../class-names.ts";
import { spaceValue } from "../space.ts";
import type { SpaceStep } from "../space.ts";
type ClusterStyle = CSSProperties & {
  readonly "--discern-cluster-gap"?: string;
};
export interface ClusterProps extends HTMLAttributes<HTMLDivElement> {
  readonly gap?: SpaceStep;
  readonly align?: "start" | "center" | "end" | "baseline" | "stretch";
  readonly justify?: "start" | "center" | "end" | "between";
  readonly children: ReactNode;
}
export const Cluster = forwardRef<HTMLDivElement, ClusterProps>(
  function Cluster(
    {
      gap = 3,
      align = "center",
      justify = "start",
      className,
      style,
      children,
      ...props
    },
    ref,
  ) {
    const clusterStyle: ClusterStyle = {
      "--discern-cluster-gap": spaceValue(gap),
      ...style,
    };
    return (
      <div
        ref={ref}
        className={classNames(
          "discern-cluster",
          `discern-cluster--align-${align}`,
          `discern-cluster--justify-${justify}`,
          className,
        )}
        style={clusterStyle}
        {...props}
      >
        {children}
      </div>
    );
  },
);
