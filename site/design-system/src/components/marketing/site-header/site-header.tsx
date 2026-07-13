import { forwardRef } from "react";
import type { HTMLAttributes, ReactNode } from "react";
import { classNames } from "../../class-names.ts";

export interface SiteHeaderNavItem {
  readonly label: ReactNode;
  readonly href: string;
}

export interface SiteHeaderProps extends HTMLAttributes<HTMLElement> {
  readonly brand: ReactNode;
  readonly brandMark?: ReactNode;
  readonly homeHref?: string;
  readonly navItems?: readonly SiteHeaderNavItem[];
  readonly navLabel?: string;
  readonly actions?: ReactNode;
  readonly notice?: ReactNode;
  readonly sticky?: boolean;
}

export const SiteHeader = forwardRef<HTMLElement, SiteHeaderProps>(
  function SiteHeader(
    {
      brand,
      brandMark,
      homeHref = "/",
      navItems = [],
      navLabel = "Primary",
      actions,
      notice,
      sticky = false,
      className,
      ...props
    },
    ref,
  ) {
    return (
      <header
        ref={ref}
        className={classNames(
          "ds-site-header",
          sticky && "ds-site-header--sticky",
          Boolean(notice) && "ds-site-header--with-notice",
          className,
        )}
        {...props}
      >
        {notice ? <div className="ds-site-header__notice">{notice}</div> : null}
        <div className="ds-site-header__inner">
          <a className="ds-site-header__brand" href={homeHref}>
            {brandMark
              ? (
                <span className="ds-site-header__mark" aria-hidden="true">
                  {brandMark}
                </span>
              )
              : null}
            <span>{brand}</span>
          </a>
          {navItems.length
            ? (
              <nav className="ds-site-header__nav" aria-label={navLabel}>
                {navItems.map((item) => (
                  <a href={item.href} key={item.href}>{item.label}</a>
                ))}
              </nav>
            )
            : null}
          {actions
            ? <div className="ds-site-header__actions">{actions}</div>
            : null}
        </div>
      </header>
    );
  },
);
