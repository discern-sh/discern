import { forwardRef } from "react";
import type { CSSProperties, HTMLAttributes, ReactNode } from "react";
import { classNames } from "../../class-names.ts";

export interface WindowProps
  extends Omit<HTMLAttributes<HTMLElement>, "title"> {
  readonly title?: ReactNode;
  readonly bodyStyle?: CSSProperties;
  readonly children: ReactNode;
}
export const Window = forwardRef<HTMLElement, WindowProps>(
  function Window({ title, bodyStyle, className, children, ...props }, ref) {
    return (
      <figure
        ref={ref}
        className={classNames("discern-window", className)}
        {...props}
      >
        <div
          className="discern-window__bar"
          aria-hidden={title ? undefined : true}
        >
          <span className="discern-window__dot" />
          <span className="discern-window__dot" />
          <span className="discern-window__dot" />
          {title
            ? <span className="discern-window__title">{title}</span>
            : null}
        </div>
        <div className="discern-window__body" style={bodyStyle}>{children}</div>
      </figure>
    );
  },
);
