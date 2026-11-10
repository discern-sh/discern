/** One card on the wall, in each of its three kinds. */
import type { PointerEvent, ReactElement } from "react";
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

/** The number a numeral card leads with. The other kinds lead with none. */
export function cardNumeral(card: WallCard): string | undefined {
  return card.kind === "numeral" ? card.numeral : undefined;
}

/**
 * Where the pointer sits inside the card it is over: one number per axis, from
 * -1 at the leading edge to 1 at the trailing edge and 0 at the center. The
 * stylesheet turns the pair into that card's tilt and the light on its own
 * face. Both are written on the card's root, so they reach no other card.
 */
const POINTER_X = "--wall-pointer-x";
const POINTER_Y = "--wall-pointer-y";

/**
 * How far `at` lies across a span that starts at `start` and is `size` long,
 * from -1 to 1. A point outside the span reads as its nearest edge, which
 * keeps the tilt inside the limit the stylesheet multiplies it by.
 */
export function pointerOffset(at: number, start: number, size: number): number {
  if (!(size > 0)) return 0;
  return Math.max(-1, Math.min(1, ((at - start) / size) * 2 - 1));
}

/** A card's box in page coordinates, which scrolling leaves unchanged. */
interface CardBox {
  readonly left: number;
  readonly top: number;
  readonly width: number;
  readonly height: number;
}

/** The box of each card a pointer is over, measured as the pointer entered. */
const entered = new WeakMap<HTMLElement, CardBox>();

/** Write the pointer's place inside the card it is over. Reads no layout. */
function followPointer(event: PointerEvent<HTMLLIElement>): void {
  const card = event.currentTarget;
  const box = entered.get(card);
  if (box === undefined) return;
  card.style.setProperty(
    POINTER_X,
    pointerOffset(event.pageX, box.left, box.width).toFixed(3),
  );
  card.style.setProperty(
    POINTER_Y,
    pointerOffset(event.pageY, box.top, box.height).toFixed(3),
  );
}

/**
 * Measure a card once as a pointer that can hover enters it. This is the only
 * layout read the card makes; every move inside it is arithmetic on the box
 * kept here. A finger never hovers, so touch is left alone.
 */
function enterCard(event: PointerEvent<HTMLLIElement>): void {
  if (event.pointerType === "touch") return;
  const card = event.currentTarget;
  const rect = card.getBoundingClientRect();
  entered.set(card, {
    left: rect.left + event.pageX - event.clientX,
    top: rect.top + event.pageY - event.clientY,
    width: rect.width,
    height: rect.height,
  });
  followPointer(event);
}

/** Return the card to rest: the stylesheet's centered values apply again. */
function leaveCard(event: PointerEvent<HTMLLIElement>): void {
  const card = event.currentTarget;
  entered.delete(card);
  card.style.removeProperty(POINTER_X);
  card.style.removeProperty(POINTER_Y);
}

/**
 * A card as one list item. The root carries `wall-card`, its kind as
 * `wall-card--<kind>`, and its cluster hue as `--wall-hue`. The heading holds
 * the card's one button, which the stylesheet stretches over the whole face.
 *
 * A numeral card's number sits inside that button, ahead of the title, so it
 * is part of the heading and of the button's name: assistive technology reads
 * "36 Limits on itself" wherever it reads the card, and reads the number once.
 */
export function Card({ card, receded, onOpen }: CardProps): ReactElement {
  const glyph = cardGlyph(card);
  const numeral = cardNumeral(card);
  const heading = cardHeading(card);
  return (
    <li
      className={`wall-card wall-card--${card.kind}`}
      data-card={card.id}
      data-receded={receded ? "" : undefined}
      style={clusterHueStyle(card.cluster)}
      onPointerEnter={enterCard}
      onPointerMove={followPointer}
      onPointerLeave={leaveCard}
    >
      <div className="wall-card-face">
        {glyph === undefined
          ? null
          : <Glyph name={glyph} className="wall-card-glyph" />}
        <h2 className="wall-card-title">
          <button
            type="button"
            className="wall-card-open"
            aria-haspopup="dialog"
            onClick={() => onOpen(card.id)}
          >
            {numeral === undefined
              ? null
              : <span className="wall-card-numeral">{numeral}</span>}
            {numeral === undefined ? heading : ` ${heading}`}
          </button>
        </h2>
        {card.kind === "statement"
          ? null
          : <p className="wall-card-line">{card.line}</p>}
      </div>
    </li>
  );
}
