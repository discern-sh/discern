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
        className={classNames("ds-window", className)}
        {...props}
      >
        <div className="ds-window__bar" aria-hidden={title ? undefined : true}>
          <span className="ds-window__dot" />
          <span className="ds-window__dot" />
          <span className="ds-window__dot" />
          {title ? <span className="ds-window__title">{title}</span> : null}
        </div>
        <div className="ds-window__body" style={bodyStyle}>{children}</div>
      </figure>
    );
  },
);
