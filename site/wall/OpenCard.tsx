/** The opened card: one card's full account as a sheet in a modal dialog. */
import {
  type KeyboardEvent,
  type ReactElement,
  type SyntheticEvent,
  useCallback,
  useRef,
} from "react";
import { cardGlyph, cardHeading, cardNumeral } from "./Card.tsx";
import { clusterHueStyle } from "./clusters.ts";
import { Glyph } from "./Glyph.tsx";
import { type LinkLabels, linkRoute } from "./host.ts";
import type { WallCard } from "./types.ts";
import { fellOutside } from "./use_open_card.ts";

export interface OpenCardProps {
  /** The card to show, or null while none is open. */
  readonly card: WallCard | null;
  /** The title of each manual page a card links to, by that page's route. */
  readonly linkLabels: LinkLabels;
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

/**
 * Whether a pointer event was aimed outside the sheet.
 *
 * A modal dialog's backdrop reports its events on the dialog itself. While a
 * view transition runs, the browser tests nothing on the page for a hit, and
 * every pointer event lands on the document's root wherever it fell. Then
 * only its place can answer, against the box the sheet is laid out in: that
 * box is the sheet's resting place from the moment the dialog mounts, however
 * far the transition has drawn it from there.
 */
function aimedOutside(dialog: HTMLDialogElement, event: MouseEvent): boolean {
  if (event.target === dialog) return true;
  if (event.target !== document.documentElement) return false;
  return fellOutside(dialog.getBoundingClientRect(), event);
}

/**
 * Ask the dialog to cancel when the visitor clicks outside the sheet, which
 * is how Escape asks too. Returns the function that stops asking.
 *
 * The click counts from the moment the dialog mounts, while the sheet is
 * still arriving as much as once it rests. A click that began as a press
 * inside the sheet and ended outside it was a drag, and is no request to
 * leave. The later clicks of the double click that opened the card never
 * arrive here: `useClickSequence` drops them, so a card that is
 * double-clicked opens and stays open.
 */
function cancelOnOutsideClick(dialog: HTMLDialogElement): () => void {
  let pressedOutside = false;
  const notePress = (event: PointerEvent): void => {
    pressedOutside = aimedOutside(dialog, event);
  };
  const ask = (event: MouseEvent): void => {
    if (pressedOutside && aimedOutside(dialog, event)) {
      dialog.dispatchEvent(new Event("cancel", { cancelable: true }));
    }
  };
  document.addEventListener("pointerdown", notePress);
  document.addEventListener("click", ask);
  return () => {
    document.removeEventListener("pointerdown", notePress);
    document.removeEventListener("click", ask);
  };
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
 * What a card's link says: the title of the manual page it leads to, so the
 * link names where it goes. A page the table does not cover is named by its
 * own address, so a link is never blank.
 */
function linkLabel(href: string, labels: LinkLabels): string {
  const route = linkRoute(href);
  return labels[route] ?? route;
}

/**
 * Show `card` as a modal sheet and nothing while it is null, so the server
 * markup never contains a dialog.
 *
 * The sheet leads with the card's glyph or numeral, then its heading, its
 * line, the optional second paragraph, and a link into the manual when the
 * card names a page. The link is named by the page it leads to. A numeral
 * sits inside the heading, as it does on the card, so the dialog and the
 * button that opened it share one name and assistive technology reads the
 * number once.
 *
 * The close control comes first in the sheet and takes focus as the dialog
 * opens. A sheet too tall for a small or zoomed screen scrolls inside itself,
 * and a browser that can focus a box that scrolls would choose that box
 * before the control, so the control is handed the focus outright. The
 * stylesheet keeps the control in the sheet's corner while the words scroll
 * under it.
 *
 * The dialog opens as it mounts and closes natively just before it unmounts,
 * which returns focus to the card button that opened it. Every way of leaving
 * only asks through `onClose`: the owner decides how the sheet goes. While
 * the dialog is open the page behind it cannot scroll, and it keeps its exact
 * width.
 */
export function OpenCard(
  { card, linkLabels, onClose }: OpenCardProps,
): ReactElement | null {
  const mounted = useRef<HTMLDialogElement | null>(null);
  const closer = useRef<HTMLButtonElement | null>(null);
  const unwatch = useRef<(() => void) | null>(null);
  const attach = useCallback((dialog: HTMLDialogElement | null): void => {
    const page = document.documentElement;
    if (dialog !== null && !dialog.open) {
      page.style.setProperty(
        SCROLLBAR_ROOM,
        `${globalThis.innerWidth - page.clientWidth}px`,
      );
      dialog.showModal();
      closer.current?.focus({ preventScroll: true });
      unwatch.current = cancelOnOutsideClick(dialog);
    }
    if (dialog === null) {
      unwatch.current?.();
      unwatch.current = null;
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
  // owner close it the same way every other route does. A click outside the
  // sheet arrives here as the same request.
  const askToClose = (event: SyntheticEvent<HTMLDialogElement>): void => {
    event.preventDefault();
    onClose();
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
      onKeyDown={ignoreHeldKey}
    >
      <div className="wall-open-face">
        <button
          ref={closer}
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
              {`${linkLabel(card.href, linkLabels)} `}
              <span aria-hidden="true">→</span>
            </a>
          </p>
        )}
      </div>
    </dialog>
  );
}
