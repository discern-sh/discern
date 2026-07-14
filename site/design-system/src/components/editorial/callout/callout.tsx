import { forwardRef } from "react";
import type { HTMLAttributes, ReactNode } from "react";
import { classNames } from "../../class-names.ts";

export interface CalloutProps
  extends Omit<HTMLAttributes<HTMLElement>, "title"> {
  readonly eyebrow?: ReactNode;
  readonly title: ReactNode;
  readonly children: ReactNode;
  readonly icon?: ReactNode;
  readonly tone?: "note" | "insight" | "warning" | "success";
}

export const Callout = forwardRef<HTMLElement, CalloutProps>(function Callout(
  {
    eyebrow,
    title,
    children,
    icon,
    tone = "note",
    className,
    ...props
  },
  ref,
) {
  return (
    <aside
      ref={ref}
      className={classNames(
        "ds-callout",
        `ds-callout--${tone}`,
        className,
      )}
      role="note"
      {...props}
    >
      {icon
        ? <span className="ds-callout__icon" aria-hidden="true">{icon}</span>
        : null}
      <div>
        {eyebrow
          ? <span className="ds-callout__eyebrow">{eyebrow}</span>
          : null}
        <h3>{title}</h3>
        <div className="ds-callout__body">{children}</div>
      </div>
    </aside>
  );
});
