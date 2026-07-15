import { forwardRef } from "react";
import type { HTMLAttributes, ReactNode } from "react";
import { classNames } from "../../class-names.ts";

export interface AudienceGridItem {
  readonly eyebrow?: ReactNode;
  readonly title: ReactNode;
  readonly description: ReactNode;
  readonly icon?: ReactNode;
  readonly meta?: ReactNode;
  readonly href?: string;
  readonly linkLabel?: ReactNode;
  readonly featured?: boolean;
}

export interface AudienceGridProps
  extends Omit<HTMLAttributes<HTMLElement>, "title"> {
  readonly eyebrow?: ReactNode;
  readonly title: ReactNode;
  readonly description?: ReactNode;
  readonly items: readonly AudienceGridItem[];
}

export const AudienceGrid = forwardRef<HTMLElement, AudienceGridProps>(
  function AudienceGrid(
    { eyebrow, title, description, items, className, ...props },
    ref,
  ) {
    return (
      <section
        ref={ref}
        className={classNames("discern-audience-grid", className)}
        {...props}
      >
        <div className="discern-audience-grid__inner">
          <header className="discern-audience-grid__header">
            <div>
              {eyebrow
                ? (
                  <div className="discern-audience-grid__eyebrow">
                    {eyebrow}
                  </div>
                )
                : null}
              <h2>{title}</h2>
            </div>
            {description
              ? (
                <div className="discern-audience-grid__description">
                  {description}
                </div>
              )
              : null}
          </header>
          <div className="discern-audience-grid__items">
            {items.map((item, index) => (
              <article
                className={classNames(
                  "discern-audience-grid__item",
                  item.featured && "discern-audience-grid__item--featured",
                )}
                key={index}
              >
                <div className="discern-audience-grid__topline">
                  {item.icon
                    ? (
                      <span
                        className="discern-audience-grid__icon"
                        aria-hidden="true"
                      >
                        {item.icon}
                      </span>
                    )
                    : null}
                  <span
                    className="discern-audience-grid__index"
                    aria-hidden="true"
                  >
                    {String(index + 1).padStart(2, "0")}
                  </span>
                </div>
                {item.eyebrow
                  ? (
                    <div className="discern-audience-grid__item-eyebrow">
                      {item.eyebrow}
                    </div>
                  )
                  : null}
                <h3>{item.title}</h3>
                <div className="discern-audience-grid__copy">
                  {item.description}
                </div>
                {item.meta
                  ? (
                    <div className="discern-audience-grid__meta">
                      {item.meta}
                    </div>
                  )
                  : null}
                {item.href && item.linkLabel
                  ? (
                    <a className="discern-audience-grid__link" href={item.href}>
                      {item.linkLabel}
                      <span aria-hidden="true">→</span>
                    </a>
                  )
                  : null}
              </article>
            ))}
          </div>
        </div>
      </section>
    );
  },
);
