import { forwardRef } from "react";
import type { HTMLAttributes, ReactNode } from "react";
import { classNames } from "../../class-names.ts";

export interface FeatureBentoItem {
  readonly title: ReactNode;
  readonly description: ReactNode;
  readonly eyebrow?: ReactNode;
  readonly icon?: ReactNode;
  readonly visual?: ReactNode;
  readonly size?: "standard" | "wide" | "tall" | "large";
  readonly tone?: "plain" | "accent" | "sunken";
}

export interface FeatureBentoProps
  extends Omit<HTMLAttributes<HTMLElement>, "title"> {
  readonly eyebrow?: ReactNode;
  readonly title: ReactNode;
  readonly description?: ReactNode;
  readonly items: readonly FeatureBentoItem[];
}

export const FeatureBento = forwardRef<HTMLElement, FeatureBentoProps>(
  function FeatureBento(
    { eyebrow, title, description, items, className, ...props },
    ref,
  ) {
    return (
      <section
        ref={ref}
        className={classNames("ds-feature-bento", className)}
        {...props}
      >
        <div className="ds-feature-bento__inner">
          <header className="ds-feature-bento__header">
            {eyebrow
              ? <div className="ds-feature-bento__eyebrow">{eyebrow}</div>
              : null}
            <h2>{title}</h2>
            {description
              ? (
                <div className="ds-feature-bento__description">
                  {description}
                </div>
              )
              : null}
          </header>
          <div className="ds-feature-bento__grid">
            {items.map((item, index) => (
              <article
                className={classNames(
                  "ds-feature-bento__item",
                  `ds-feature-bento__item--${item.size ?? "standard"}`,
                  `ds-feature-bento__item--${item.tone ?? "plain"}`,
                )}
                key={index}
              >
                <div className="ds-feature-bento__copy">
                  {item.icon
                    ? (
                      <span
                        className="ds-feature-bento__icon"
                        aria-hidden="true"
                      >
                        {item.icon}
                      </span>
                    )
                    : null}
                  {item.eyebrow
                    ? (
                      <div className="ds-feature-bento__item-eyebrow">
                        {item.eyebrow}
                      </div>
                    )
                    : null}
                  <h3>{item.title}</h3>
                  <div>{item.description}</div>
                </div>
                {item.visual
                  ? (
                    <div className="ds-feature-bento__visual">
                      {item.visual}
                    </div>
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
