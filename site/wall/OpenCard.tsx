/** The opened card: one card's full account as a sheet in a modal dialog. */
import {
  type KeyboardEvent,
  type MouseEvent,
  type ReactElement,
  type SyntheticEvent,
  useCallback,
  useRef,
} from "react";
import { cardGlyph, cardHeading, cardNumeral } from "./Card.tsx";
import { clusterHueStyle } from "./clusters.ts";
import { Glyph } from "./Glyph.tsx";
import type { WallCard } from "./types.ts";

export interface OpenCardProps {
  /** The card to show, or null while none is open. */
  readonly card: WallCard | null;
  /**
   * Called when the visitor asks to leave: Escape, the close control, or a
   * click outside the sheet. The owner answers by passing a null `card`, and
   * the dialog closes as it unmounts.
   */
  readonly onClose: () => void;
}

/**
 * The width of the page's scrollbar, written to the document root just before
 * the dialog opens. While the dialog is open the stylesheet stops the page
 * from scrolling, which removes the scrollbar, and pads the page by this
 * much, so the page keeps its width and nothing shifts.
 */
const SCROLLBAR_ROOM = "--wall-open-scrollbar";

/** The sheet's heading names the dialog, and its line describes it. */
const TITLE_ID = "wall-open-title";
const LINE_ID = "wall-open-line";

/**
 * Keep a held key from acting twice. Without this, holding Enter on a card
 * would open the sheet and then press whatever took focus inside it, over and
 * over, for as long as the key stayed down.
 */
function ignoreHeldKey(event: KeyboardEvent<HTMLDialogElement>): void {
  if (event.repeat && (event.key === "Enter" || event.key === " ")) {
    event.preventDefault();
  }
}

/** The mark on the close control: a plain cross, drawn rather than typed. */
function CloseMark(): ReactElement {
  return (
    <svg
      className="wall-open-cross"
      viewBox="0 0 16 16"
      width="16"
      height="16"
      aria-hidden="true"
      focusable="false"
    >
      <path d="M3.75 3.75l8.5 8.5m0-8.5l-8.5 8.5" />
    </svg>
  );
}

/**
 * Show `card` as a modal sheet and nothing while it is null, so the server
 * markup never contains a dialog.
 *
 * The sheet leads with the card's glyph or numeral, then its heading, its
 * line, the optional second paragraph, and a link to the docs when the card
 * names a page. A numeral sits inside the heading, as it does on the card, so
 * the dialog and the button that opened it share one name and assistive
 * technology reads the number once.
 *
 * The close control comes first in the sheet, so it takes focus when the
 * dialog opens. The dialog opens as it mounts and closes natively just before
 * it unmounts, which returns focus to the card button that opened it. Every
 * way of leaving only asks through `onClose`: the owner decides how the sheet
 * goes. While the dialog is open the page behind it cannot scroll, and it
 * keeps its exact width.
 */
export function OpenCard(
  { card, onClose }: OpenCardProps,
): ReactElement | null {
  const mounted = useRef<HTMLDialogElement | null>(null);
  const pressedOutside = useRef(false);
  const attach = useCallback((dialog: HTMLDialogElement | null): void => {
    const page = document.documentElement;
    if (dialog !== null && !dialog.open) {
      page.style.setProperty(
        SCROLLBAR_ROOM,
        `${globalThis.innerWidth - page.clientWidth}px`,
      );
      dialog.showModal();
    }
    if (dialog === null) {
      if (mounted.current?.open === true) mounted.current.close();
      page.style.removeProperty(SCROLLBAR_ROOM);
    }
    mounted.current = dialog;
  }, []);
  if (card === null) return null;

  const glyph = cardGlyph(card);
  const numeral = cardNumeral(card);
  const heading = cardHeading(card);
  // The browser closes a dialog on Escape by itself. Refusing that lets the
  // owner close it the same way every other route does.
  const askToClose = (event: SyntheticEvent<HTMLDialogElement>): void => {
    event.preventDefault();
    onClose();
  };
  // A modal dialog's backdrop reports pointer events on the dialog itself. A
  // press that began inside the sheet and ended outside it is not a request
  // to leave.
  const notePress = (event: MouseEvent<HTMLDialogElement>): void => {
    pressedOutside.current = event.target === event.currentTarget;
  };
  const closeOutside = (event: MouseEvent<HTMLDialogElement>): void => {
    if (pressedOutside.current && event.target === event.currentTarget) {
      onClose();
    }
  };
  return (
    <dialog
      ref={attach}
      className={`wall-open wall-open--${card.kind}`}
      aria-labelledby={TITLE_ID}
      aria-describedby={card.kind === "statement" ? undefined : LINE_ID}
      style={clusterHueStyle(card.cluster)}
      onCancel={askToClose}
      onClose={onClose}
      onPointerDown={notePress}
      onClick={closeOutside}
      onKeyDown={ignoreHeldKey}
    >
      <div className="wall-open-face">
        <button
          type="button"
          className="wall-open-close"
          aria-label="Close"
          onClick={onClose}
        >
          <CloseMark />
        </button>
        {glyph === undefined
          ? null
          : <Glyph name={glyph} className="wall-open-glyph" />}
        <h2 id={TITLE_ID} className="wall-open-title">
          {numeral === undefined
            ? null
            : <span className="wall-open-numeral">{numeral}</span>}
          {numeral === undefined ? heading : ` ${heading}`}
        </h2>
        {card.kind === "statement"
          ? null
          : <p id={LINE_ID} className="wall-open-line">{card.line}</p>}
        {card.more === undefined
          ? null
          : <p className="wall-open-more">{card.more}</p>}
        {card.href === undefined ? null : (
          <p className="wall-open-foot">
            <a className="wall-open-link" href={card.href}>
              Read the docs <span aria-hidden="true">→</span>
            </a>
          </p>
        )}
      </div>
    </dialog>
  );
}
