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
          "ds-cta-band",
          `ds-cta-band--${tone}`,
          `ds-cta-band--${align}`,
          Boolean(visual) && "ds-cta-band--with-visual",
          className,
        )}
        {...props}
      >
        <div className="ds-cta-band__inner">
          <div className="ds-cta-band__content">
            {eyebrow
              ? <div className="ds-cta-band__eyebrow">{eyebrow}</div>
              : null}
            <h2>{title}</h2>
            {description
              ? <div className="ds-cta-band__description">{description}</div>
              : null}
            {actions
              ? <div className="ds-cta-band__actions">{actions}</div>
              : null}
            {note ? <div className="ds-cta-band__note">{note}</div> : null}
          </div>
          {visual ? <div className="ds-cta-band__visual">{visual}</div> : null}
        </div>
      </section>
    );
  },
);
