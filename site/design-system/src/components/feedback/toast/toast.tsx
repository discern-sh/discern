import { forwardRef, useEffect } from "react";
import type { HTMLAttributes, ReactNode } from "react";
import { classNames } from "../../class-names.ts";

export type ToastTone = "neutral" | "success" | "warning" | "danger";
export interface ToastProps extends HTMLAttributes<HTMLDivElement> {
  readonly tone?: ToastTone;
  readonly icon?: ReactNode;
  readonly onDismiss?: () => void;
  readonly duration?: number;
  readonly dismissLabel?: string;
  readonly children: ReactNode;
}
export const Toast = forwardRef<HTMLDivElement, ToastProps>(
  function Toast(
    {
      tone = "neutral",
      icon,
      onDismiss,
      duration,
      dismissLabel = "Dismiss notification",
      className,
      children,
      role,
      ...props
    },
    ref,
  ) {
    useEffect(() => {
      if (!duration || !onDismiss) return;
      const timer = globalThis.setTimeout(onDismiss, duration);
      return () => globalThis.clearTimeout(timer);
    }, [duration, onDismiss]);
    const semanticRole = role ?? (tone === "danger" ? "alert" : "status");
    return (
      <div
        ref={ref}
        role={semanticRole}
        className={classNames("ds-toast", `ds-toast--${tone}`, className)}
        {...props}
      >
        {icon
          ? <span className="ds-toast__icon" aria-hidden="true">{icon}</span>
          : null}
        <span className="ds-toast__content">{children}</span>
        {onDismiss
          ? (
            <button
              type="button"
              className="ds-toast__dismiss"
              aria-label={dismissLabel}
              onClick={onDismiss}
            >
              <span aria-hidden="true">×</span>
            </button>
          )
          : null}
      </div>
    );
  },
);

export interface ToastRegionProps extends HTMLAttributes<HTMLDivElement> {
  readonly label?: string;
}
export const ToastRegion = forwardRef<HTMLDivElement, ToastRegionProps>(
  function ToastRegion({ label = "Notifications", className, ...props }, ref) {
    return (
      <div
        ref={ref}
        aria-label={label}
        className={classNames("ds-toast-region", className)}
        {...props}
      />
    );
  },
);
