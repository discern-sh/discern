import { forwardRef } from "react";
import type { HTMLAttributes, ReactNode } from "react";
import { classNames } from "../../class-names.ts";

export interface TestimonialProps extends HTMLAttributes<HTMLElement> {
  readonly eyebrow?: ReactNode;
  readonly quote: ReactNode;
  readonly author: ReactNode;
  readonly authorRole?: ReactNode;
  readonly avatar?: ReactNode;
  readonly metric?: ReactNode;
  readonly metricLabel?: ReactNode;
  readonly mark?: ReactNode;
  readonly layout?: "wide" | "card";
}

export const Testimonial = forwardRef<HTMLElement, TestimonialProps>(
  function Testimonial(
    {
      eyebrow,
      quote,
      author,
      authorRole,
      avatar,
      metric,
      metricLabel,
      mark = "“",
      layout = "wide",
      className,
      ...props
    },
    ref,
  ) {
    return (
      <section
        ref={ref}
        className={classNames(
          "ds-testimonial",
          `ds-testimonial--${layout}`,
          className,
        )}
        {...props}
      >
        <figure className="ds-testimonial__frame">
          <div className="ds-testimonial__mark" aria-hidden="true">{mark}</div>
          <div className="ds-testimonial__main">
            {eyebrow
              ? <div className="ds-testimonial__eyebrow">{eyebrow}</div>
              : null}
            <blockquote>{quote}</blockquote>
            <figcaption>
              {avatar
                ? (
                  <span className="ds-testimonial__avatar" aria-hidden="true">
                    {avatar}
                  </span>
                )
                : null}
              <span>
                <strong>{author}</strong>
                {authorRole ? <span>{authorRole}</span> : null}
              </span>
            </figcaption>
          </div>
          {metric
            ? (
              <div className="ds-testimonial__metric">
                <strong>{metric}</strong>
                {metricLabel ? <span>{metricLabel}</span> : null}
              </div>
            )
            : null}
        </figure>
      </section>
    );
  },
);
