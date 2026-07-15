import { forwardRef } from "react";
import type { HTMLAttributes, ReactNode } from "react";
import { classNames } from "../../class-names.ts";

export interface ComparisonRow {
  readonly feature: ReactNode;
  readonly first: ReactNode;
  readonly second: ReactNode;
}

export interface ComparisonTableProps
  extends Omit<HTMLAttributes<HTMLElement>, "title"> {
  readonly eyebrow?: ReactNode;
  readonly title: ReactNode;
  readonly description?: ReactNode;
  readonly featureLabel?: string;
  readonly firstLabel: string;
  readonly secondLabel: string;
  readonly rows: readonly ComparisonRow[];
  readonly secondBadge?: ReactNode;
}

export const ComparisonTable = forwardRef<HTMLElement, ComparisonTableProps>(
  function ComparisonTable(
    {
      eyebrow,
      title,
      description,
      featureLabel = "Capability",
      firstLabel,
      secondLabel,
      rows,
      secondBadge,
      className,
      ...props
    },
    ref,
  ) {
    return (
      <section
        ref={ref}
        className={classNames("discern-comparison-table", className)}
        {...props}
      >
        <div className="discern-comparison-table__inner">
          <header className="discern-comparison-table__header">
            {eyebrow
              ? (
                <div className="discern-comparison-table__eyebrow">
                  {eyebrow}
                </div>
              )
              : null}
            <h2>{title}</h2>
            {description
              ? (
                <div className="discern-comparison-table__description">
                  {description}
                </div>
              )
              : null}
          </header>
          <div className="discern-comparison-table__frame">
            <table>
              <thead>
                <tr>
                  <th scope="col">{featureLabel}</th>
                  <th scope="col">{firstLabel}</th>
                  <th
                    scope="col"
                    className="discern-comparison-table__highlight"
                  >
                    <span>{secondLabel}</span>
                    {secondBadge
                      ? (
                        <span className="discern-comparison-table__badge">
                          {secondBadge}
                        </span>
                      )
                      : null}
                  </th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row, index) => (
                  <tr key={index}>
                    <th scope="row">{row.feature}</th>
                    <td data-label={firstLabel}>{row.first}</td>
                    <td
                      data-label={secondLabel}
                      className="discern-comparison-table__highlight"
                    >
                      {row.second}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </section>
    );
  },
);
