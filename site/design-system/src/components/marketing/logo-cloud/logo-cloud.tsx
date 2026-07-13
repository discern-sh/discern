import { forwardRef } from "react";
import type { HTMLAttributes, ReactNode } from "react";
import { classNames } from "../../class-names.ts";

export interface LogoCloudItem {
  readonly name: string;
  readonly mark?: ReactNode;
}

export interface LogoCloudProps extends HTMLAttributes<HTMLElement> {
  readonly label?: ReactNode;
  readonly items: readonly LogoCloudItem[];
  readonly align?: "start" | "center";
}

export const LogoCloud = forwardRef<HTMLElement, LogoCloudProps>(
  function LogoCloud(
    { label, items, align = "center", className, ...props },
    ref,
  ) {
    return (
      <section
        ref={ref}
        className={classNames(
          "ds-logo-cloud",
          `ds-logo-cloud--${align}`,
          className,
        )}
        {...props}
      >
        {label ? <p className="ds-logo-cloud__label">{label}</p> : null}
        <ul className="ds-logo-cloud__list">
          {items.map((item) => (
            <li key={item.name}>
              {item.mark
                ? (
                  <span className="ds-logo-cloud__mark" aria-hidden="true">
                    {item.mark}
                  </span>
                )
                : null}
              <span>{item.name}</span>
            </li>
          ))}
        </ul>
      </section>
    );
  },
);
