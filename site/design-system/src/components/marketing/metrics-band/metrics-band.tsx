import { forwardRef } from "react";
import type { HTMLAttributes, ReactNode } from "react";
import { classNames } from "../../class-names.ts";

export interface MetricItem {
  readonly value: ReactNode;
  readonly label: ReactNode;
  readonly detail?: ReactNode;
}

export interface MetricsBandProps
  extends Omit<HTMLAttributes<HTMLElement>, "title"> {
  readonly eyebrow?: ReactNode;
  readonly title?: ReactNode;
  readonly items: readonly MetricItem[];
  readonly tone?: "surface" | "accent" | "contrast";
}

export const MetricsBand = forwardRef<HTMLElement, MetricsBandProps>(
  function MetricsBand(
    { eyebrow, title, items, tone = "surface", className, ...props },
    ref,
  ) {
    return (
      <section
        ref={ref}
        className={classNames(
          "ds-metrics-band",
          `ds-metrics-band--${tone}`,
          className,
        )}
        {...props}
      >
        <div className="ds-metrics-band__inner">
          {eyebrow || title
            ? (
              <header className="ds-metrics-band__header">
                {eyebrow
                  ? <div className="ds-metrics-band__eyebrow">{eyebrow}</div>
                  : null}
                {title ? <h2>{title}</h2> : null}
              </header>
            )
            : null}
          <dl className="ds-metrics-band__list">
            {items.map((item, index) => (
              <div key={index}>
                <dd>{item.value}</dd>
                <dt>{item.label}</dt>
                {item.detail
                  ? <div className="ds-metrics-band__detail">{item.detail}</div>
                  : null}
              </div>
            ))}
          </dl>
        </div>
      </section>
    );
  },
);
