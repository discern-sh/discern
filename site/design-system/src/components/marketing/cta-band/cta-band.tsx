import { forwardRef } from "react";
import type { HTMLAttributes, ReactNode } from "react";
import { classNames } from "../../class-names.ts";

export interface CtaBandProps
  extends Omit<HTMLAttributes<HTMLElement>, "title"> {
  readonly eyebrow?: ReactNode;
  readonly title: ReactNode;
  readonly description?: ReactNode;
  readonly actions?: ReactNode;
  readonly note?: ReactNode;
  readonly visual?: ReactNode;
  readonly tone?: "accent" | "sunken" | "contrast";
  readonly align?: "center" | "split";
}

export const CtaBand = forwardRef<HTMLElement, CtaBandProps>(
  function CtaBand(
    {
      eyebrow,
      title,
      description,
      actions,
      note,
      visual,
      tone = "accent",
      align = "center",
      className,
      ...props
    },
    ref,
  ) {
    return (
      <section
        ref={ref}
        className={classNames(
          "discern-cta-band",
          `discern-cta-band--${tone}`,
          `discern-cta-band--${align}`,
          Boolean(visual) && "discern-cta-band--with-visual",
          className,
        )}
        {...props}
      >
        <div className="discern-cta-band__inner">
          <div className="discern-cta-band__content">
            {eyebrow
              ? <div className="discern-cta-band__eyebrow">{eyebrow}</div>
              : null}
            <h2>{title}</h2>
            {description
              ? (
                <div className="discern-cta-band__description">
                  {description}
                </div>
              )
              : null}
            {actions
              ? <div className="discern-cta-band__actions">{actions}</div>
              : null}
            {note ? <div className="discern-cta-band__note">{note}</div> : null}
          </div>
          {visual
            ? <div className="discern-cta-band__visual">{visual}</div>
            : null}
        </div>
      </section>
    );
  },
);
