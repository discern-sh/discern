/** The opened card: one card's full account in a modal dialog. */
import { type MouseEvent, type ReactElement, useEffect, useRef } from "react";
import { cardGlyph, cardHeading } from "./Card.tsx";
import { clusterHueStyle } from "./clusters.ts";
import { Glyph } from "./Glyph.tsx";
import type { WallCard } from "./types.ts";

export interface OpenCardProps {
  /** The card to show, or null while none is open. */
  readonly card: WallCard | null;
  /**
   * Called once the dialog has closed, whether by Escape, its Close button, or
   * a click outside it. The owner clears its open-card state in response.
   */
  readonly onClose: () => void;
}

/**
 * Show `card` as a modal dialog and nothing while it is null, so the server
 * markup never contains a dialog. The dialog always closes natively before it
 * unmounts, which returns focus to the card button that opened it.
 */
export function OpenCard(
  { card, onClose }: OpenCardProps,
): ReactElement | null {
  const dialog = useRef<HTMLDialogElement>(null);
  const shown = card !== null;
  useEffect(() => {
    const element = dialog.current;
    if (shown && element !== null && !element.open) element.showModal();
  }, [shown]);
  if (card === null) return null;

  const glyph = cardGlyph(card);
  // A modal dialog's backdrop reports clicks on the dialog element itself.
  const closeOutside = (event: MouseEvent<HTMLDialogElement>): void => {
    if (event.target === event.currentTarget) event.currentTarget.close();
  };
  return (
    <dialog
      ref={dialog}
      className={`wall-open wall-open--${card.kind}`}
      aria-labelledby="wall-open-title"
      style={clusterHueStyle(card.cluster)}
      onClose={onClose}
      onClick={closeOutside}
    >
      <div className="wall-open-face">
        {glyph === undefined
          ? null
          : <Glyph name={glyph} className="wall-open-glyph" />}
        <h2 id="wall-open-title" className="wall-open-title">
          {cardHeading(card)}
        </h2>
        {card.kind === "statement"
          ? null
          : <p className="wall-open-line">{card.line}</p>}
        {card.more === undefined
          ? null
          : <p className="wall-open-more">{card.more}</p>}
        <div className="wall-open-foot">
          {card.href === undefined
            ? null
            : (
              <a className="wall-open-link" href={card.href}>
                Read the docs
              </a>
            )}
          <button
            type="button"
            className="wall-open-close"
            onClick={() => dialog.current?.close()}
          >
            Close
          </button>
        </div>
      </div>
    </dialog>
  );
}
