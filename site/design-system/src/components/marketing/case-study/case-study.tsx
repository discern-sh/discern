import { forwardRef } from "react";
import type { HTMLAttributes, ReactNode } from "react";
import { classNames } from "../../class-names.ts";

export interface CaseStudyStat {
  readonly value: ReactNode;
  readonly label: ReactNode;
}

export interface CaseStudyProps
  extends Omit<HTMLAttributes<HTMLElement>, "title"> {
  readonly eyebrow?: ReactNode;
  readonly title: ReactNode;
  readonly summary: ReactNode;
  readonly body?: ReactNode;
  readonly stats?: readonly CaseStudyStat[];
  readonly media?: ReactNode;
  readonly action?: ReactNode;
  readonly reverse?: boolean;
}

export const CaseStudy = forwardRef<HTMLElement, CaseStudyProps>(
  function CaseStudy(
    {
      eyebrow,
      title,
      summary,
      body,
      stats = [],
      media,
      action,
      reverse = false,
      className,
      ...props
    },
    ref,
  ) {
    return (
      <article
        ref={ref}
        className={classNames(
          "discern-case-study",
          reverse && "discern-case-study--reverse",
          className,
        )}
        {...props}
      >
        <div className="discern-case-study__inner">
          <div className="discern-case-study__story">
            {eyebrow
              ? <div className="discern-case-study__eyebrow">{eyebrow}</div>
              : null}
            <h2>{title}</h2>
            <div className="discern-case-study__summary">{summary}</div>
            {body
              ? <div className="discern-case-study__body">{body}</div>
              : null}
            {action
              ? <div className="discern-case-study__action">{action}</div>
              : null}
          </div>
          <aside className="discern-case-study__evidence">
            {media
              ? <div className="discern-case-study__media">{media}</div>
              : null}
            {stats.length
              ? (
                <dl className="discern-case-study__stats">
                  {stats.map((stat, index) => (
                    <div key={index}>
                      <dd>{stat.value}</dd>
                      <dt>{stat.label}</dt>
                    </div>
                  ))}
                </dl>
              )
              : null}
          </aside>
        </div>
      </article>
    );
  },
);
