import { forwardRef } from "react";
import type { HTMLAttributes, ReactNode } from "react";
import { classNames } from "../../class-names.ts";

export interface PullQuoteProps extends HTMLAttributes<HTMLElement> {
  readonly quote: ReactNode;
  readonly attribution?: ReactNode;
  readonly citation?: ReactNode;
  readonly citeUrl?: string;
  readonly align?: "inline" | "wide";
}

export const PullQuote = forwardRef<HTMLElement, PullQuoteProps>(
  function PullQuote(
    {
      quote,
      attribution,
      citation,
      citeUrl,
      align = "wide",
      className,
      ...props
    },
    ref,
  ) {
    return (
      <figure
        ref={ref}
        className={classNames(
          "ds-pull-quote",
          `ds-pull-quote--${align}`,
          className,
        )}
        {...props}
      >
        <span className="ds-pull-quote__mark" aria-hidden="true">“</span>
        <blockquote cite={citeUrl}>{quote}</blockquote>
        {attribution || citation
          ? (
            <figcaption>
              {attribution ? <strong>{attribution}</strong> : null}
              {citation ? <cite>{citation}</cite> : null}
            </figcaption>
          )
          : null}
      </figure>
    );
  },
);
