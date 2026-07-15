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
          "discern-site-header",
          sticky && "discern-site-header--sticky",
          Boolean(notice) && "discern-site-header--with-notice",
          className,
        )}
        {...props}
      >
        {notice
          ? <div className="discern-site-header__notice">{notice}</div>
          : null}
        <div className="discern-site-header__inner">
          <a className="discern-site-header__brand" href={homeHref}>
            {brandMark
              ? (
                <span className="discern-site-header__mark" aria-hidden="true">
                  {brandMark}
                </span>
              )
              : null}
            <span>{brand}</span>
          </a>
          {navItems.length
            ? (
              <nav className="discern-site-header__nav" aria-label={navLabel}>
                {navItems.map((item) => (
                  <a href={item.href} key={item.href}>{item.label}</a>
                ))}
              </nav>
            )
            : null}
          {actions
            ? <div className="discern-site-header__actions">{actions}</div>
            : null}
        </div>
      </header>
    );
  },
);
