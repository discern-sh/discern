import { forwardRef } from "react";
import type { HTMLAttributes, ReactNode } from "react";
import { classNames } from "../../class-names.ts";

export interface TableOfContentsItem {
  readonly label: ReactNode;
  readonly href: string;
  readonly current?: boolean;
}

export interface TableOfContentsProps
  extends Omit<HTMLAttributes<HTMLElement>, "title"> {
  readonly title?: ReactNode;
  readonly items: readonly TableOfContentsItem[];
  readonly progress?: ReactNode;
  readonly label?: string;
}

export const TableOfContents = forwardRef<HTMLElement, TableOfContentsProps>(
  function TableOfContents(
    {
      title = "On this page",
      items,
      progress,
      label = "Table of contents",
      className,
      ...props
    },
    ref,
  ) {
    return (
      <nav
        ref={ref}
        className={classNames("ds-table-of-contents", className)}
        aria-label={label}
        {...props}
      >
        <strong className="ds-table-of-contents__title">{title}</strong>
        <ol>
          {items.map((item, index) => (
            <li
              className={classNames(
                item.current && "ds-table-of-contents__item--current",
              )}
              key={item.href}
            >
              <a
                href={item.href}
                aria-current={item.current ? "location" : undefined}
              >
                <span>{String(index + 1).padStart(2, "0")}</span>
                {item.label}
              </a>
            </li>
          ))}
        </ol>
        {progress
          ? <div className="ds-table-of-contents__progress">{progress}</div>
          : null}
      </nav>
    );
  },
);
