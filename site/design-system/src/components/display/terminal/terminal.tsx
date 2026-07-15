import { forwardRef } from "react";
import type { CSSProperties, HTMLAttributes, ReactNode } from "react";
import { classNames } from "../../class-names.ts";

export interface TerminalProps
  extends Omit<HTMLAttributes<HTMLElement>, "title"> {
  readonly title?: ReactNode;
  readonly bodyStyle?: CSSProperties;
  readonly children: ReactNode;
}

export const Terminal = forwardRef<HTMLElement, TerminalProps>(
  function Terminal({ title, bodyStyle, className, children, ...props }, ref) {
    return (
      <figure
        ref={ref}
        className={classNames("discern-terminal", className)}
        {...props}
      >
        <div
          className="discern-terminal__bar"
          aria-hidden={title ? undefined : true}
        >
          <span className="discern-terminal__dot" />
          <span className="discern-terminal__dot" />
          <span className="discern-terminal__dot" />
          {title
            ? <span className="discern-terminal__title">{title}</span>
            : null}
        </div>
        <pre className="discern-terminal__body" style={bodyStyle}>
          <code>{children}</code>
        </pre>
      </figure>
    );
  },
);
