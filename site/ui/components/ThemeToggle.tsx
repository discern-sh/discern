/** The package theme control as markup, for shells that compose HTML strings. */
import { renderToStaticMarkup } from "react-dom/server";
import {
  type StaticThemeToggleProps,
  ThemeToggle,
} from "discern-design-system/react";

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
