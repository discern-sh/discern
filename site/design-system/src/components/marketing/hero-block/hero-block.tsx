import { forwardRef } from "react";
import type { HTMLAttributes, ReactNode } from "react";
import { classNames } from "../../class-names.ts";

export interface HeroBlockProps
  extends Omit<HTMLAttributes<HTMLElement>, "title"> {
  readonly eyebrow?: ReactNode;
  readonly title: ReactNode;
  readonly headingLevel?: 1 | 2;
  readonly description?: ReactNode;
  readonly actions?: ReactNode;
  readonly meta?: ReactNode;
  readonly visual?: ReactNode;
  readonly layout?: "split" | "centered";
  readonly surface?: "canvas" | "sunken" | "accent";
}

export const HeroBlock = forwardRef<HTMLElement, HeroBlockProps>(
  function HeroBlock(
    {
      eyebrow,
      title,
      headingLevel = 1,
      description,
      actions,
      meta,
      visual,
      layout = "split",
      surface = "canvas",
      className,
      ...props
    },
    ref,
  ) {
    const Heading = headingLevel === 1 ? "h1" : "h2";
    return (
      <section
        ref={ref}
        className={classNames(
          "ds-hero-block",
          `ds-hero-block--${layout}`,
          `ds-hero-block--${surface}`,
          !visual && "ds-hero-block--without-visual",
          className,
        )}
        {...props}
      >
        <div className="ds-hero-block__inner">
          <div className="ds-hero-block__content">
            {eyebrow
              ? <div className="ds-hero-block__eyebrow">{eyebrow}</div>
              : null}
            <Heading className="ds-hero-block__title">{title}</Heading>
            {description
              ? <div className="ds-hero-block__description">{description}</div>
              : null}
            {actions
              ? <div className="ds-hero-block__actions">{actions}</div>
              : null}
            {meta ? <div className="ds-hero-block__meta">{meta}</div> : null}
          </div>
          {visual
            ? <div className="ds-hero-block__visual">{visual}</div>
            : null}
        </div>
      </section>
    );
  },
);
