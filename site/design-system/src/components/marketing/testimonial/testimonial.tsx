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
          "discern-testimonial",
          `discern-testimonial--${layout}`,
          className,
        )}
        {...props}
      >
        <figure className="discern-testimonial__frame">
          <div className="discern-testimonial__mark" aria-hidden="true">
            {mark}
          </div>
          <div className="discern-testimonial__main">
            {eyebrow
              ? <div className="discern-testimonial__eyebrow">{eyebrow}</div>
              : null}
            <blockquote>{quote}</blockquote>
            <figcaption>
              {avatar
                ? (
                  <span
                    className="discern-testimonial__avatar"
                    aria-hidden="true"
                  >
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
              <div className="discern-testimonial__metric">
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
