/** The corpus search palette, rendered as static markup for page-owned enhancement. */
import type { ReactElement } from "react";
import { Icon, Kbd, SearchPalette } from "discern-design-system/react";
import { SearchIcon } from "./DocumentIcons.tsx";

export interface DocumentSearchProps {
  /** What the palette searches, e.g. `the manual`. */
  readonly searchLabel: string;
  /** The JSON index the page-owned script fetches once per visit. */
  readonly endpoint: string;
}

/** The listbox the combobox controls and the script fills. */
const RESULTS_ID = "docs-search-results";

/** The page-owned script finds the field by this hook, not by package anatomy. */
const INPUT_HOOK = { "data-search-input": "" };

/**
 * The package palette is a hydrated component: its effects and handlers do
 * not run in this server-rendered output. The rendered dialog, field, and hint
 * are the static contract; the results region carries the page-owned hooks
 * that `docs.js` activates, including the fallback for readers whose
 * `<dialog>` lacks `showModal()`.
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
        open={false}
        onOpenChange={() => undefined}
        label={label}
        placeholder={`${label}…`}
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
          ...INPUT_HOOK,
        }}
        data-search=""
        data-search-endpoint={endpoint}
      >
        <ul
          className="docs-search-results"
          id={RESULTS_ID}
          role="listbox"
          aria-label="Search results"
          data-search-results=""
        />
        <button
          className="docs-search-all"
          type="button"
          data-search-all=""
          hidden
        />
        <p className="docs-search-empty" data-search-empty="" hidden />
        <div
          className="discern-visually-hidden"
          role="status"
          aria-live="polite"
          aria-atomic="true"
          data-search-status=""
        />
      </SearchPalette>
    </>
  );
}
