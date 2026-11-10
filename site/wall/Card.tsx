/** One card on the wall, in each of its three kinds. */
import type { ReactElement } from "react";
import { clusterHueStyle } from "./clusters.ts";
import { Glyph } from "./Glyph.tsx";
import type { WallCard } from "./types.ts";

export interface CardProps {
  readonly card: WallCard;
  /** Outside the active lens. The stylesheet dims a receded card; it stays in the list. */
  readonly receded: boolean;
  /** Called with the card's id when its button is activated. */
  readonly onOpen: (id: string) => void;
}

/** The words that name a card: its title, or a statement card's whole statement. */
export function cardHeading(card: WallCard): string {
  return card.kind === "statement" ? card.text : card.title;
}

/** The glyph a benefit card shows: its own key, or its id when it names none. */
export function cardGlyph(card: WallCard): string | undefined {
  return card.kind === "benefit" ? card.glyph ?? card.id : undefined;
}

/**
 * A card as one list item. The root carries `wall-card`, its kind as
 * `wall-card--<kind>`, and its cluster hue as `--wall-hue`. The heading holds
 * the card's one button, which the stylesheet stretches over the whole face.
 */
export function Card({ card, receded, onOpen }: CardProps): ReactElement {
  const glyph = cardGlyph(card);
  return (
    <li
      className={`wall-card wall-card--${card.kind}`}
      data-card={card.id}
      data-receded={receded ? "" : undefined}
      style={clusterHueStyle(card.cluster)}
    >
      <div className="wall-card-face">
        {glyph === undefined
          ? null
          : <Glyph name={glyph} className="wall-card-glyph" />}
        {card.kind === "numeral"
          ? (
            <p className="wall-card-numeral" aria-hidden="true">
              {card.numeral}
            </p>
          )
          : null}
        <h2 className="wall-card-title">
          <button
            type="button"
            className="wall-card-open"
            aria-haspopup="dialog"
            onClick={() => onOpen(card.id)}
          >
            {cardHeading(card)}
          </button>
        </h2>
        {card.kind === "statement"
          ? null
          : <p className="wall-card-line">{card.line}</p>}
      </div>
    </li>
  );
}
