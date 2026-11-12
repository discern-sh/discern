/** The site's theme control: the package control, offered where a document's theme is its reader's to choose. */
import { createContext, type ReactElement, useContext } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import {
  type StaticThemeToggleProps,
  ThemeToggle,
} from "discern-design-system/react";
import { DOCUMENT_THEMES, type DocumentTheme } from "../../theme.ts";

/**
 * The theme of the document being rendered. `Document` provides it, so a
 * header inside reads the same choice the root and the head were rendered
 * from, and a route states its theme once.
 */
export const DocumentThemeContext = createContext<DocumentTheme>("reader");

/**
 * The control for a header's actions slot, or nothing where the document's
 * theme is fixed. A header hands the result straight to the slot, so a fixed
 * document renders no empty slot either.
 */
export function useThemeToggle(
  props: StaticThemeToggleProps = {},
): ReactElement | undefined {
  const theme = useContext(DocumentThemeContext);
  return DOCUMENT_THEMES[theme].control
    ? <ThemeToggle {...props} />
    : undefined;
}

/**
 * React pages take the control from `useThemeToggle`. A shell that builds
 * HTML strings renders it here instead of restating the control's markup, so
 * every site control carries the one static contract the package behavior
 * activates.
 */
export function renderThemeToggleHtml(
  props: StaticThemeToggleProps = {},
): string {
  return renderToStaticMarkup(<ThemeToggle {...props} />);
}
