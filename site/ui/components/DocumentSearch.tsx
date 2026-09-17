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

/** The listbox the combobox controls and the script fills. */
const RESULTS_ID = "docs-search-results";

/**
 * Without `onOpenChange` the package renders the dialog closed and stamps
 * its bindable hooks on the dialog, field, and close control; `docs.js`
 * owns opening, dismissal, the query, and the fallback for readers whose
 * `<dialog>` lacks `showModal()`. The results region carries the page-owned
 * hooks that script fills.
 */
export function DocumentSearch(
  { searchLabel, endpoint }: DocumentSearchProps,
): ReactElement {
  const label = `Search ${searchLabel}`;
  return (
    <>
      <div className="docs-search-backdrop" data-search-backdrop="" hidden />
      <SearchPalette
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
    </>
  );
}
