/** The explicit insertion boundary for trusted, already-rendered HTML and authored scripts. */
import type { HTMLAttributes, ReactElement } from "react";

interface HtmlFragmentProps
  extends
    Omit<HTMLAttributes<HTMLElement>, "children" | "dangerouslySetInnerHTML"> {
  readonly as?: "div" | "script";
  readonly html: string;
}

/** Callers supply package-rendered Markdown or a repository-owned script, never request text. */
export function HtmlFragment(
  { as: Element = "div", html, ...props }: HtmlFragmentProps,
): ReactElement {
  return <Element {...props} dangerouslySetInnerHTML={{ __html: html }} />;
}
