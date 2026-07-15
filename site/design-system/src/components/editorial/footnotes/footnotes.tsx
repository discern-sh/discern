import { forwardRef } from "react";
import type { HTMLAttributes, ReactNode } from "react";
import { classNames } from "../../class-names.ts";

export interface FootnoteItem {
  readonly id: string;
  readonly content: ReactNode;
  readonly backHref?: string;
}

export interface FootnotesProps
  extends Omit<HTMLAttributes<HTMLElement>, "title"> {
  readonly title?: ReactNode;
  readonly items: readonly FootnoteItem[];
}

export const Footnotes = forwardRef<HTMLElement, FootnotesProps>(
  function Footnotes(
    { title = "Notes & sources", items, className, ...props },
    ref,
  ) {
    return (
      <section
        ref={ref}
        className={classNames("discern-footnotes", className)}
        {...props}
      >
        <header>
          <span aria-hidden="true">†</span>
          <h2>{title}</h2>
        </header>
        <ol>
          {items.map((item, index) => (
            <li id={item.id} key={item.id}>
              <span>{String(index + 1).padStart(2, "0")}</span>
              <div>{item.content}</div>
              {item.backHref
                ? (
                  <a
                    href={item.backHref}
                    aria-label={`Return from note ${index + 1}`}
                  >
                    ↩
                  </a>
                )
                : null}
            </li>
          ))}
        </ol>
      </section>
    );
  },
);
