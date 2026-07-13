import { forwardRef } from "react";
import type { ButtonHTMLAttributes, ReactNode } from "react";
import { classNames } from "../../class-names.ts";

export interface IconButtonProps
  extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, "children"> {
  readonly icon: ReactNode;
  readonly label: string;
  readonly variant?: "quiet" | "outline";
  readonly size?: "sm" | "md" | "lg";
}

export const IconButton = forwardRef<HTMLButtonElement, IconButtonProps>(
  function IconButton(
    {
      icon,
      label,
      variant = "quiet",
      size = "md",
      className,
      type = "button",
      ...props
    },
    ref,
  ) {
    return (
      <button
        ref={ref}
        type={type}
        aria-label={label}
        className={classNames(
          "ds-icon-button",
          `ds-icon-button--${variant}`,
          `ds-icon-button--${size}`,
          className,
        )}
        {...props}
      >
        <span aria-hidden="true">{icon}</span>
      </button>
    );
  },
);
