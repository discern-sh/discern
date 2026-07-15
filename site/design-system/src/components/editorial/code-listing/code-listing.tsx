import { forwardRef } from "react";
import type { HTMLAttributes, ReactNode } from "react";
import { classNames } from "../../class-names.ts";

export interface CodeListingProps
  extends Omit<HTMLAttributes<HTMLElement>, "title"> {
  readonly title?: ReactNode;
  readonly filename?: ReactNode;
  readonly language?: string;
  readonly code: string;
  readonly highlightLines?: readonly number[];
  readonly caption?: ReactNode;
}

export const CodeListing = forwardRef<HTMLElement, CodeListingProps>(
  function CodeListing(
    {
      title,
      filename,
      language,
      code,
      highlightLines = [],
      caption,
      className,
      ...props
    },
    ref,
  ) {
    const lines = code.trimEnd().split("\n");
    return (
      <figure
        ref={ref}
        className={classNames("discern-code-listing", className)}
        {...props}
      >
        {title || filename || language
          ? (
            <header className="discern-code-listing__header">
              <span>
                <i aria-hidden="true" />
                <i aria-hidden="true" />
                <i aria-hidden="true" />
              </span>
              <strong>{filename ?? title}</strong>
              {language ? <small>{language}</small> : null}
            </header>
          )
          : null}
        <pre className="discern-code-listing__body" data-language={language}>
          <code>
            {lines.map((line, index) => (
              <span
                className={classNames(
                  "discern-code-listing__line",
                  highlightLines.includes(index + 1) &&
                    "discern-code-listing__line--highlighted",
                )}
                data-line={index + 1}
                key={index}
              >
                {line || " "}
              </span>
            ))}
          </code>
        </pre>
        {caption ? <figcaption>{caption}</figcaption> : null}
      </figure>
    );
  },
);
