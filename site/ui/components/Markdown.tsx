/** Package-rendered Markdown placed within a page's heading and anchor scope. */
import type { ReactElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { Markdown as PackageMarkdown } from "discern-design-system/react";
import { escapeHtml } from "../../../src/lib/markdown.ts";
import { HtmlFragment } from "./HtmlFragment.tsx";

interface MarkdownProps {
  readonly source: string;
  readonly idPrefix: string;
  readonly firstHeadingLevel: number;
  readonly className?: string;
}

/** Scope package output without owning its parser, component markup, or styles. */
export function Markdown(
  { source, idPrefix, firstHeadingLevel, className }: MarkdownProps,
): ReactElement {
  const rendered = renderToStaticMarkup(<PackageMarkdown source={source} />);
  const levels = [...rendered.matchAll(/<h([1-6])\b/g)].map((match) =>
    Number(match[1])
  );
  const offset = levels.length === 0
    ? 0
    : firstHeadingLevel - Math.min(...levels);
  const prefix = escapeHtml(idPrefix);
  const html = rendered.replace(
    /id="([^"]*)"/g,
    (_match, id: string) => `id="${prefix}${id}"`,
  )
    .replace(
      /href="#([^"]*)"/g,
      (_match, id: string) => `href="#${prefix}${id}"`,
    )
    .replace(
      /<(\/?)h([1-6])\b/g,
      (_match, slash: string, level: string) =>
        `<${slash}h${Math.min(6, Number(level) + offset)}`,
    );
  return (
    <HtmlFragment
      html={html}
      {...(className === undefined ? {} : { className })}
    />
  );
}
