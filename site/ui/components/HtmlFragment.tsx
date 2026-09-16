/** The explicit insertion boundary for trusted, already-rendered HTML and authored scripts. */
import type { HTMLAttributes, ReactElement } from "react";

interface HtmlFragmentProps
  extends
    Omit<HTMLAttributes<HTMLElement>, "children" | "dangerouslySetInnerHTML"> {
  readonly as?: "div" | "span" | "script";
  readonly html: string;
}

/** Callers supply repository-owned markup or an authored script, never request text. */
export function HtmlFragment(
  { as: Element = "div", html, ...props }: HtmlFragmentProps,
): ReactElement {
  return <Element {...props} dangerouslySetInnerHTML={{ __html: html }} />;
}
