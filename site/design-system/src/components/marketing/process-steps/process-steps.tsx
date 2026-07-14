import { forwardRef } from "react";
import type { HTMLAttributes, ReactNode } from "react";
import { classNames } from "../../class-names.ts";

export interface ProcessStep {
  readonly title: ReactNode;
  readonly description: ReactNode;
  readonly eyebrow?: ReactNode;
  readonly detail?: ReactNode;
}

export interface ProcessStepsProps
  extends Omit<HTMLAttributes<HTMLElement>, "title"> {
  readonly eyebrow?: ReactNode;
  readonly title: ReactNode;
  readonly description?: ReactNode;
  readonly steps: readonly ProcessStep[];
  readonly orientation?: "horizontal" | "vertical";
}

export const ProcessSteps = forwardRef<HTMLElement, ProcessStepsProps>(
  function ProcessSteps(
    {
      eyebrow,
      title,
      description,
      steps,
      orientation = "horizontal",
      className,
      ...props
    },
    ref,
  ) {
    return (
      <section
        ref={ref}
        className={classNames(
          "ds-process-steps",
          `ds-process-steps--${orientation}`,
          className,
        )}
        {...props}
      >
        <div className="ds-process-steps__inner">
          <header className="ds-process-steps__header">
            <div>
              {eyebrow
                ? <div className="ds-process-steps__eyebrow">{eyebrow}</div>
                : null}
              <h2>{title}</h2>
            </div>
            {description
              ? (
                <div className="ds-process-steps__description">
                  {description}
                </div>
              )
              : null}
          </header>
          <ol className="ds-process-steps__list">
            {steps.map((step, index) => (
              <li key={index}>
                <div className="ds-process-steps__marker">
                  <span>{String(index + 1).padStart(2, "0")}</span>
                </div>
                <div className="ds-process-steps__content">
                  {step.eyebrow
                    ? (
                      <div className="ds-process-steps__step-eyebrow">
                        {step.eyebrow}
                      </div>
                    )
                    : null}
                  <h3>{step.title}</h3>
                  <div className="ds-process-steps__copy">
                    {step.description}
                  </div>
                  {step.detail
                    ? (
                      <div className="ds-process-steps__detail">
                        {step.detail}
                      </div>
                    )
                    : null}
                </div>
              </li>
            ))}
          </ol>
        </div>
      </section>
    );
  },
);
