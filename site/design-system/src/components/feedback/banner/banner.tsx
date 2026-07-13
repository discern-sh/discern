import { forwardRef } from "react";
import type { HTMLAttributes, ReactNode } from "react";
import { classNames } from "../../class-names.ts";

export type BannerTone =
  | "neutral"
  | "accent"
  | "success"
  | "warning"
  | "danger";
export interface BannerProps extends HTMLAttributes<HTMLDivElement> {
  readonly tone?: BannerTone;
  readonly icon?: ReactNode;
  readonly children: ReactNode;
}
export const Banner = forwardRef<HTMLDivElement, BannerProps>(
  function Banner(
    { tone = "neutral", icon, children, className, role, ...props },
    ref,
  ) {
    const semanticRole = role ?? (tone === "danger" ? "alert" : "status");
    return (
      <div
        ref={ref}
        role={semanticRole}
        className={classNames("ds-banner", `ds-banner--${tone}`, className)}
        {...props}
      >
        {icon
          ? <span className="ds-banner__icon" aria-hidden="true">{icon}</span>
          : null}
        <div>{children}</div>
      </div>
    );
  },
);
