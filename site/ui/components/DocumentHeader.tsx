/** The document shell's top bar: drawer control, lockup, search opener, theme control. */
import type { ReactElement } from "react";
import {
  DocsHeader,
  Icon,
  IconButton,
  Kbd,
  ThemeToggle,
} from "discern-design-system/react";
import { DiscernBrand } from "./Brand.tsx";
import { MenuIcon, MoonIcon, SearchIcon, SunIcon } from "./DocumentIcons.tsx";

export interface DocumentHeaderProps {
  /** The corpus root the context link returns to, e.g. `/docs`. */
  readonly rootRoute: string;
  /** The context shown beside the lockup, e.g. `/docs`. */
  readonly contextLabel: string;
  /** What the search control searches, e.g. `the manual`. */
  readonly searchLabel: string;
  /** The `id` of the navigation the drawer control expands. */
  readonly navigationId: string;
}

/**
 * The package behaviors activate the drawer toggle, which renders hidden
 * until the layout makes the navigation a drawer, and the theme control;
 * page-owned script activates the search control through its `data-*` hook.
 */
export function DocumentHeader(
  { rootRoute, contextLabel, searchLabel, navigationId }: DocumentHeaderProps,
): ReactElement {
  return (
    <DocsHeader
      className="docs-top"
      brand={
        <>
          <IconButton
            className="docs-burger"
            icon={<MenuIcon />}
            label="Open navigation"
            hidden
            data-discern-docs-drawer-toggle=""
            data-discern-open-label="Open navigation"
            data-discern-close-label="Close navigation"
            aria-controls={navigationId}
            aria-expanded={false}
          />
          <span className="docs-brand-lockup">
            <a className="docs-brand" href="/">
              <DiscernBrand />
            </a>
            <a className="docs-brand-docs discern-mono" href={rootRoute}>
              {contextLabel}
            </a>
          </span>
        </>
      }
      actions={
        <ThemeToggle
          className="docs-theme"
          lightGlyph={<SunIcon className="docs-theme-icon" />}
          darkGlyph={<MoonIcon className="docs-theme-icon" />}
        />
      }
    >
      <button
        className="docs-search-btn"
        type="button"
        data-search-open=""
        aria-label={`Search ${searchLabel}`}
      >
        <Icon className="docs-search-icon">
          <SearchIcon />
        </Icon>
        <span className="docs-search-btn-word">Search {searchLabel}</span>
        <Kbd>⌘K</Kbd>
      </button>
    </DocsHeader>
  );
}
