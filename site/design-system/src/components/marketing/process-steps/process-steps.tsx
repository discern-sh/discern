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
          "discern-process-steps",
          `discern-process-steps--${orientation}`,
          className,
        )}
        {...props}
      >
        <div className="discern-process-steps__inner">
          <header className="discern-process-steps__header">
            <div>
              {eyebrow
                ? (
                  <div className="discern-process-steps__eyebrow">
                    {eyebrow}
                  </div>
                )
                : null}
              <h2>{title}</h2>
            </div>
            {description
              ? (
                <div className="discern-process-steps__description">
                  {description}
                </div>
              )
              : null}
          </header>
          <ol className="discern-process-steps__list">
            {steps.map((step, index) => (
              <li key={index}>
                <div className="discern-process-steps__marker">
                  <span>{String(index + 1).padStart(2, "0")}</span>
                </div>
                <div className="discern-process-steps__content">
                  {step.eyebrow
                    ? (
                      <div className="discern-process-steps__step-eyebrow">
                        {step.eyebrow}
                      </div>
                    )
                    : null}
                  <h3>{step.title}</h3>
                  <div className="discern-process-steps__copy">
                    {step.description}
                  </div>
                  {step.detail
                    ? (
                      <div className="discern-process-steps__detail">
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
