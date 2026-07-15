import { forwardRef } from "react";
import type { HTMLAttributes, ReactNode } from "react";
import { classNames } from "../../class-names.ts";

export interface ArticleAuthor {
  readonly name: ReactNode;
  readonly role?: ReactNode;
  readonly initials?: ReactNode;
}

export interface ArticleHeaderProps
  extends Omit<HTMLAttributes<HTMLElement>, "title"> {
  readonly eyebrow?: ReactNode;
  readonly title: ReactNode;
  readonly standfirst: ReactNode;
  readonly authors?: readonly ArticleAuthor[];
  readonly meta?: readonly ReactNode[];
  readonly actions?: ReactNode;
  readonly media?: ReactNode;
  readonly headingLevel?: 1 | 2;
  readonly surface?: "canvas" | "sunken" | "accent";
}

export const ArticleHeader = forwardRef<HTMLElement, ArticleHeaderProps>(
  function ArticleHeader(
    {
      eyebrow,
      title,
      standfirst,
      authors = [],
      meta = [],
      actions,
      media,
      headingLevel = 1,
      surface = "canvas",
      className,
      ...props
    },
    ref,
  ) {
    const Heading = headingLevel === 1 ? "h1" : "h2";
    return (
      <header
        ref={ref}
        className={classNames(
          "discern-article-header",
          `discern-article-header--${surface}`,
          Boolean(media) && "discern-article-header--with-media",
          className,
        )}
        {...props}
      >
        <div className="discern-article-header__inner">
          <div className="discern-article-header__copy">
            {eyebrow
              ? <div className="discern-article-header__eyebrow">{eyebrow}</div>
              : null}
            <Heading>{title}</Heading>
            <div className="discern-article-header__standfirst">
              {standfirst}
            </div>
            {authors.length || meta.length || actions
              ? (
                <div className="discern-article-header__footer">
                  {authors.length
                    ? (
                      <address className="discern-article-header__authors">
                        {authors.map((author, index) => (
                          <span
                            className="discern-article-header__author"
                            key={index}
                          >
                            {author.initials
                              ? (
                                <span
                                  className="discern-article-header__avatar"
                                  aria-hidden="true"
                                >
                                  {author.initials}
                                </span>
                              )
                              : null}
                            <span>
                              <strong>{author.name}</strong>
                              {author.role
                                ? <small>{author.role}</small>
                                : null}
                            </span>
                          </span>
                        ))}
                      </address>
                    )
                    : null}
                  {meta.length
                    ? (
                      <ul className="discern-article-header__meta">
                        {meta.map((item, index) => <li key={index}>{item}</li>)}
                      </ul>
                    )
                    : null}
                  {actions
                    ? (
                      <div className="discern-article-header__actions">
                        {actions}
                      </div>
                    )
                    : null}
                </div>
              )
              : null}
          </div>
          {media
            ? <div className="discern-article-header__media">{media}</div>
            : null}
        </div>
      </header>
    );
  },
);
