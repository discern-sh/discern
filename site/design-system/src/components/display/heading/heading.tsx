import { forwardRef } from "react";
import type { HTMLAttributes, ReactNode } from "react";
import { classNames } from "../../class-names.ts";

export type HeadingLevel = 1 | 2 | 3 | 4 | 5 | 6;
export interface HeadingProps extends HTMLAttributes<HTMLHeadingElement> {
  readonly level?: HeadingLevel;
  readonly children: ReactNode;
}
export interface HeadingAccentProps extends HTMLAttributes<HTMLSpanElement> {
  readonly children: ReactNode;
}

export const Heading = forwardRef<HTMLHeadingElement, HeadingProps>(
  function Heading(
    { level = 2, className, children, ...props },
    ref,
  ) {
    const Element = `h${level}` as const;
    return (
      <Element
        ref={ref}
        className={classNames("ds-heading", className)}
        {...props}
      >
        {children}
      </Element>
    );
  },
);

export const HeadingAccent = forwardRef<HTMLSpanElement, HeadingAccentProps>(
  function HeadingAccent(
    { className, children, ...props },
    ref,
  ) {
    return (
      <span
        ref={ref}
        className={classNames("ds-heading__accent", className)}
        {...props}
      >
        {children}
      </span>
    );
  },
);
