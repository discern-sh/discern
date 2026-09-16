/** The package theme control as markup, for shells that compose HTML strings. */
import { renderToStaticMarkup } from "react-dom/server";
import {
  type StaticThemeToggleProps,
  ThemeToggle,
} from "discern-design-system/react";
import { HtmlFragment } from "./HtmlFragment.tsx";

/**
 * The drawn glyphs the document shell uses in place of the default characters.
 * Each carries its own intrinsic size, so no package class sizes it here.
 */
export interface ThemeToggleGlyphs {
  readonly light: string;
  readonly dark: string;
}

/**
 * React pages render the package component directly. A shell that builds HTML
 * strings renders it here instead of restating the control's markup, so every
 * site control carries the one static contract the package behavior activates.
 */
export function renderThemeToggleHtml(
  props: StaticThemeToggleProps = {},
): string {
  return renderToStaticMarkup(<ThemeToggle {...props} />);
}

/**
 * The document shell cannot import React, so the build emits its control as a
 * fragment. Sizing and the drawn glyphs stay shell-owned; the contract does not.
 */
export function renderDocumentThemeToggle(glyphs: ThemeToggleGlyphs): string {
  return renderThemeToggleHtml({
    className: "docs-theme",
    lightGlyph: (
      <HtmlFragment as="span" className="docs-theme-icon" html={glyphs.light} />
    ),
    darkGlyph: (
      <HtmlFragment as="span" className="docs-theme-icon" html={glyphs.dark} />
    ),
  });
}
