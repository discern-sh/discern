import { forwardRef } from "react";
import type { HTMLAttributes, ReactNode } from "react";
import { classNames } from "../../class-names.ts";

export interface ArticleLayoutProps extends HTMLAttributes<HTMLDivElement> {
  readonly navigation?: ReactNode;
  readonly navigationLabel?: string;
  readonly children: ReactNode;
  readonly rail?: ReactNode;
  readonly railLabel?: string;
}

export const ArticleLayout = forwardRef<HTMLDivElement, ArticleLayoutProps>(
  function ArticleLayout(
    {
      navigation,
      navigationLabel = "Article navigation",
      children,
      rail,
      railLabel = "Article context",
      className,
      ...props
    },
    ref,
  ) {
    return (
      <div
        ref={ref}
        className={classNames(
          "ds-article-layout",
          !navigation && "ds-article-layout--no-navigation",
          !rail && "ds-article-layout--no-rail",
          className,
        )}
        {...props}
      >
        {navigation
          ? (
            <aside
              className="ds-article-layout__navigation"
              aria-label={navigationLabel}
            >
              <div className="ds-article-layout__sticky">{navigation}</div>
            </aside>
          )
          : null}
        <article className="ds-article-layout__body">{children}</article>
        {rail
          ? (
            <aside className="ds-article-layout__rail" aria-label={railLabel}>
              <div className="ds-article-layout__sticky">{rail}</div>
            </aside>
          )
          : null}
      </div>
    );
  },
);
