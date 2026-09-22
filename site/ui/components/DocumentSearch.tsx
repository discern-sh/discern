/** The corpus search palette, rendered in the package's static mode for page-owned enhancement. */
import type { ReactElement } from "react";
import {
  Icon,
  Kbd,
  SearchPalette,
  SearchPaletteEmpty,
  SearchPaletteList,
  SearchPaletteStatus,
} from "discern-design-system/react";
import { SearchIcon } from "./DocumentIcons.tsx";

export interface DocumentSearchProps {
  /** What the palette searches, e.g. `the manual`. */
  readonly searchLabel: string;
  /** The JSON index the page-owned script fetches once per visit. */
  readonly endpoint: string;
}

/** The dialog the header's opener names; the package behaviour opens it. */
export const SEARCH_PALETTE_ID = "docs-search-palette";

/** The listbox the combobox controls and the script fills. */
const RESULTS_ID = "docs-search-results";

/**
 * Without `onOpenChange` the package renders the dialog closed with its
 * hooks, and the emitted `search-palette` behaviour opens and dismisses it,
 * including the ⌘K and `/` shortcuts and the fallback for a reader without
 * `showModal()`. `docs.js` answers its open and close events with the query,
 * the index, and the results that fill the region's page-owned hooks.
 */
export function DocumentSearch(
  { searchLabel, endpoint }: DocumentSearchProps,
): ReactElement {
  const label = `Search ${searchLabel}`;
  return (
    <SearchPalette
      id={SEARCH_PALETTE_ID}
      shortcuts
      className="docs-search"
      label={label}
      placeholder={`${label}…`}
      closeAriaLabel="Close search"
      icon={
        <Icon className="docs-search-icon">
          <SearchIcon />
        </Icon>
      }
      hint={
        <>
          <span>
            <Kbd>↑</Kbd> <Kbd>↓</Kbd> choose
          </span>
          <span>
            <Kbd>↵</Kbd> open
          </span>
          <span>
            <Kbd>Esc</Kbd> close
          </span>
        </>
      }
      inputProps={{
        role: "combobox",
        "aria-autocomplete": "list",
        "aria-expanded": false,
        "aria-controls": RESULTS_ID,
        autoComplete: "off",
        spellCheck: false,
      }}
      data-search-endpoint={endpoint}
    >
      <SearchPaletteList id={RESULTS_ID} data-search-results="" />
      <button
        className="docs-search-all"
        type="button"
        data-search-all=""
        hidden
      />
      <SearchPaletteEmpty data-search-empty="" />
      <SearchPaletteStatus data-search-status="" />
    </SearchPalette>
  );
}
