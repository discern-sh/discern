import { forwardRef } from "react";
import type { HTMLAttributes, ReactNode } from "react";
import { classNames } from "../../class-names.ts";

export interface FaqItem {
  readonly question: ReactNode;
  readonly answer: ReactNode;
}

export interface FaqBlockProps
  extends Omit<HTMLAttributes<HTMLElement>, "title"> {
  readonly eyebrow?: ReactNode;
  readonly title: ReactNode;
  readonly description?: ReactNode;
  readonly items: readonly FaqItem[];
  readonly aside?: ReactNode;
  readonly openFirst?: boolean;
}

export const FaqBlock = forwardRef<HTMLElement, FaqBlockProps>(
  function FaqBlock(
    {
      eyebrow,
      title,
      description,
      items,
      aside,
      openFirst = false,
      className,
      ...props
    },
    ref,
  ) {
    return (
      <section
        ref={ref}
        className={classNames("ds-faq-block", className)}
        {...props}
      >
        <div className="ds-faq-block__inner">
          <header className="ds-faq-block__header">
            {eyebrow
              ? <div className="ds-faq-block__eyebrow">{eyebrow}</div>
              : null}
            <h2>{title}</h2>
            {description
              ? <div className="ds-faq-block__description">{description}</div>
              : null}
            {aside ? <div className="ds-faq-block__aside">{aside}</div> : null}
          </header>
          <div className="ds-faq-block__items">
            {items.map((item, index) => (
              <details key={index} open={openFirst && index === 0}>
                <summary>
                  <span>{item.question}</span>
                  <span className="ds-faq-block__toggle" aria-hidden="true" />
                </summary>
                <div className="ds-faq-block__answer">{item.answer}</div>
              </details>
            ))}
          </div>
        </div>
      </section>
    );
  },
);
