import { forwardRef } from "react";
import type { HTMLAttributes, ReactNode } from "react";
import { classNames } from "../../class-names.ts";

export interface DataFigureLegendItem {
  readonly label: ReactNode;
  readonly tone?: "accent" | "ink" | "success" | "warning";
}

export interface DataFigureProps
  extends Omit<HTMLAttributes<HTMLElement>, "title"> {
  readonly eyebrow?: ReactNode;
  readonly title: ReactNode;
  readonly visual: ReactNode;
  readonly legend?: readonly DataFigureLegendItem[];
  readonly caption: ReactNode;
  readonly source?: ReactNode;
  readonly surface?: "canvas" | "sunken";
}

export const DataFigure = forwardRef<HTMLElement, DataFigureProps>(
  function DataFigure(
    {
      eyebrow,
      title,
      visual,
      legend = [],
      caption,
      source,
      surface = "canvas",
      className,
      ...props
    },
    ref,
  ) {
    return (
      <figure
        ref={ref}
        className={classNames(
          "discern-data-figure",
          `discern-data-figure--${surface}`,
          className,
        )}
        {...props}
      >
        <header>
          <div>
            {eyebrow ? <span>{eyebrow}</span> : null}
            <h3>{title}</h3>
          </div>
          {legend.length
            ? (
              <ul aria-label="Figure legend">
                {legend.map((item, index) => (
                  <li key={index}>
                    <i
                      className={`discern-data-figure__swatch--${
                        item.tone ?? "accent"
                      }`}
                      aria-hidden="true"
                    />
                    {item.label}
                  </li>
                ))}
              </ul>
            )
            : null}
        </header>
        <div className="discern-data-figure__visual">{visual}</div>
        <figcaption>
          <span>{caption}</span>
          {source ? <small>Source: {source}</small> : null}
        </figcaption>
      </figure>
    );
  },
);
