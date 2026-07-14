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
        className={classNames("ds-audience-grid", className)}
        {...props}
      >
        <div className="ds-audience-grid__inner">
          <header className="ds-audience-grid__header">
            <div>
              {eyebrow
                ? <div className="ds-audience-grid__eyebrow">{eyebrow}</div>
                : null}
              <h2>{title}</h2>
            </div>
            {description
              ? (
                <div className="ds-audience-grid__description">
                  {description}
                </div>
              )
              : null}
          </header>
          <div className="ds-audience-grid__items">
            {items.map((item, index) => (
              <article
                className={classNames(
                  "ds-audience-grid__item",
                  item.featured && "ds-audience-grid__item--featured",
                )}
                key={index}
              >
                <div className="ds-audience-grid__topline">
                  {item.icon
                    ? (
                      <span
                        className="ds-audience-grid__icon"
                        aria-hidden="true"
                      >
                        {item.icon}
                      </span>
                    )
                    : null}
                  <span className="ds-audience-grid__index" aria-hidden="true">
                    {String(index + 1).padStart(2, "0")}
                  </span>
                </div>
                {item.eyebrow
                  ? (
                    <div className="ds-audience-grid__item-eyebrow">
                      {item.eyebrow}
                    </div>
                  )
                  : null}
                <h3>{item.title}</h3>
                <div className="ds-audience-grid__copy">{item.description}</div>
                {item.meta
                  ? <div className="ds-audience-grid__meta">{item.meta}</div>
                  : null}
                {item.href && item.linkLabel
                  ? (
                    <a className="ds-audience-grid__link" href={item.href}>
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
