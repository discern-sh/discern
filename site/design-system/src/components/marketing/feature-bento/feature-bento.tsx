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
        className={classNames("discern-feature-bento", className)}
        {...props}
      >
        <div className="discern-feature-bento__inner">
          <header className="discern-feature-bento__header">
            {eyebrow
              ? <div className="discern-feature-bento__eyebrow">{eyebrow}</div>
              : null}
            <h2>{title}</h2>
            {description
              ? (
                <div className="discern-feature-bento__description">
                  {description}
                </div>
              )
              : null}
          </header>
          <div className="discern-feature-bento__grid">
            {items.map((item, index) => (
              <article
                className={classNames(
                  "discern-feature-bento__item",
                  `discern-feature-bento__item--${item.size ?? "standard"}`,
                  `discern-feature-bento__item--${item.tone ?? "plain"}`,
                )}
                key={index}
              >
                <div className="discern-feature-bento__copy">
                  {item.icon
                    ? (
                      <span
                        className="discern-feature-bento__icon"
                        aria-hidden="true"
                      >
                        {item.icon}
                      </span>
                    )
                    : null}
                  {item.eyebrow
                    ? (
                      <div className="discern-feature-bento__item-eyebrow">
                        {item.eyebrow}
                      </div>
                    )
                    : null}
                  <h3>{item.title}</h3>
                  <div>{item.description}</div>
                </div>
                {item.visual
                  ? (
                    <div className="discern-feature-bento__visual">
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
