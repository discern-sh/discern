import { forwardRef } from "react";
import type { HTMLAttributes, ReactNode } from "react";
import { classNames } from "../../class-names.ts";

export interface KeyPoint {
  readonly title: ReactNode;
  readonly description: ReactNode;
}

export interface KeyPointsProps
  extends Omit<HTMLAttributes<HTMLElement>, "title"> {
  readonly eyebrow?: ReactNode;
  readonly title: ReactNode;
  readonly items: readonly KeyPoint[];
  readonly tone?: "accent" | "sunken" | "contrast";
}

export const KeyPoints = forwardRef<HTMLElement, KeyPointsProps>(
  function KeyPoints(
    { eyebrow, title, items, tone = "accent", className, ...props },
    ref,
  ) {
    return (
      <section
        ref={ref}
        className={classNames(
          "ds-key-points",
          `ds-key-points--${tone}`,
          className,
        )}
        {...props}
      >
        <header>
          {eyebrow ? <span>{eyebrow}</span> : null}
          <h2>{title}</h2>
        </header>
        <ol>
          {items.map((item, index) => (
            <li key={index}>
              <span>{String(index + 1).padStart(2, "0")}</span>
              <div>
                <h3>{item.title}</h3>
                <div>{item.description}</div>
              </div>
            </li>
          ))}
        </ol>
      </section>
    );
  },
);
