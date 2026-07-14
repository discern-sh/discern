import { forwardRef } from "react";
import type { HTMLAttributes, ReactNode } from "react";
import { classNames } from "../../class-names.ts";

export interface SiteFooterLink {
  readonly label: ReactNode;
  readonly href: string;
}

export interface SiteFooterGroup {
  readonly title: ReactNode;
  readonly links: readonly SiteFooterLink[];
}

export interface SiteFooterProps extends HTMLAttributes<HTMLElement> {
  readonly brand: ReactNode;
  readonly brandMark?: ReactNode;
  readonly description?: ReactNode;
  readonly groups?: readonly SiteFooterGroup[];
  readonly legal?: ReactNode;
  readonly meta?: ReactNode;
}

export const SiteFooter = forwardRef<HTMLElement, SiteFooterProps>(
  function SiteFooter(
    {
      brand,
      brandMark,
      description,
      groups = [],
      legal,
      meta,
      className,
      ...props
    },
    ref,
  ) {
    return (
      <footer
        ref={ref}
        className={classNames("ds-site-footer", className)}
        {...props}
      >
        <div className="ds-site-footer__inner">
          <div className="ds-site-footer__brand-column">
            <a className="ds-site-footer__brand" href="/">
              {brandMark
                ? (
                  <span className="ds-site-footer__mark" aria-hidden="true">
                    {brandMark}
                  </span>
                )
                : null}
              <span>{brand}</span>
            </a>
            {description
              ? <div className="ds-site-footer__description">{description}</div>
              : null}
          </div>
          {groups.length
            ? (
              <nav className="ds-site-footer__nav" aria-label="Footer">
                {groups.map((group, index) => (
                  <div key={index}>
                    <h2>{group.title}</h2>
                    <ul>
                      {group.links.map((link) => (
                        <li key={link.href}>
                          <a href={link.href}>{link.label}</a>
                        </li>
                      ))}
                    </ul>
                  </div>
                ))}
              </nav>
            )
            : null}
          {legal || meta
            ? (
              <div className="ds-site-footer__base">
                <span>{legal}</span>
                <span>{meta}</span>
              </div>
            )
            : null}
        </div>
      </footer>
    );
  },
);
