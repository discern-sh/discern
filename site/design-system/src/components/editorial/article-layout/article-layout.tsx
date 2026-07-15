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
          "discern-article-layout",
          !navigation && "discern-article-layout--no-navigation",
          !rail && "discern-article-layout--no-rail",
          className,
        )}
        {...props}
      >
        {navigation
          ? (
            <aside
              className="discern-article-layout__navigation"
              aria-label={navigationLabel}
            >
              <div className="discern-article-layout__sticky">{navigation}</div>
            </aside>
          )
          : null}
        <article className="discern-article-layout__body">{children}</article>
        {rail
          ? (
            <aside
              className="discern-article-layout__rail"
              aria-label={railLabel}
            >
              <div className="discern-article-layout__sticky">{rail}</div>
            </aside>
          )
          : null}
      </div>
    );
  },
);
