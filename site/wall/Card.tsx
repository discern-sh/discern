/** One card on the wall, in each of its three kinds. */
import type { PointerEvent, ReactElement } from "react";
import { clusterHueStyle } from "./clusters.ts";
import { Glyph } from "./Glyph.tsx";
import type { WallCard } from "./types.ts";

export interface CardProps {
  readonly card: WallCard;
  /** Outside the active lens: the card carries `RECEDED_ATTRIBUTE` and stays in the list. */
  readonly receded: boolean;
  /** Hydration has enabled the card's dialog. Before then, use its manual link. */
  readonly live?: boolean;
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
 * The attribute a card's root carries while it sits outside the active lens.
 * The stylesheets set such a card aside by it.
 */
export const RECEDED_ATTRIBUTE = "data-receded";

/**
 * The class of the box inside each card's face that draws the shared pointer
 * light on that card's border. The pointer light finds the cards it may reach
 * by this class, and writes its place on this box alone.
 *
 * The box is empty on purpose. A browser that restyles an element looks again
 * at each of that element's children, so a value written on the face every
 * frame would cost the glyph, the heading, and the line each frame as well.
 * This box has no children to look at.
 */
export const CARD_LIGHT = "wall-card-light";

/**
 * Where the pointer sits inside the card it is over: one number per axis, from
 * -1 at the leading edge to 1 at the trailing edge and 0 at the center. The
 * stylesheet turns the pair into that card's tilt and the light on its own
 * face. Both are written on the card's root on every pointer move inside it,
 * and the stylesheet registers them so that they do not inherit: the pair
 * reaches the two boxes that ask for it by name, and is never handed down
 * through the card's glyph and its words.
 */
export const POINTER_PROPERTIES = [
  "--wall-pointer-x",
  "--wall-pointer-y",
] as const;
const [POINTER_X, POINTER_Y] = POINTER_PROPERTIES;

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
 * the card's control, which the stylesheet stretches over the whole face.
 *
 * A numeral card's number sits inside that control, ahead of the title, so it
 * is part of the heading and of the control's name: assistive technology reads
 * "36 Limits it must meet" wherever it reads the card, and reads the number
 * once.
 */
export function Card(
  { card, receded, live = false, onOpen }: CardProps,
): ReactElement {
  const glyph = cardGlyph(card);
  const numeral = cardNumeral(card);
  const heading = cardHeading(card);
  const words = (
    <>
      {numeral === undefined
        ? null
        : <span className="wall-card-numeral">{numeral}</span>}
      {numeral === undefined ? heading : ` ${heading}`}
    </>
  );
  return (
    <li
      className={`wall-card wall-card--${card.kind}`}
      data-card={card.id}
      {...{ [RECEDED_ATTRIBUTE]: receded ? "" : undefined }}
      style={clusterHueStyle(card.cluster)}
      onPointerEnter={enterCard}
      onPointerMove={followPointer}
      onPointerLeave={leaveCard}
      onClick={(event) => {
        // The pressed face can move away from the release point. The click
        // then reaches the stable list item that contains both targets.
        if (!live || event.target !== event.currentTarget) return;
        event.currentTarget.querySelector<HTMLButtonElement>(".wall-card-open")
          ?.focus({ preventScroll: true });
        onOpen(card.id);
      }}
    >
      <div className="wall-card-face">
        <span className={CARD_LIGHT} />
        {glyph === undefined
          ? null
          : <Glyph name={glyph} className="wall-card-glyph" />}
        <h2 className="wall-card-title">
          {live
            ? (
              <button
                type="button"
                className="wall-card-open"
                aria-haspopup="dialog"
                onClick={() => onOpen(card.id)}
              >
                {words}
              </button>
            )
            : card.href === undefined
            ? <span className="wall-card-open">{words}</span>
            : <a className="wall-card-open" href={card.href}>{words}</a>}
        </h2>
        {card.kind === "statement"
          ? null
          : <p className="wall-card-line">{card.line}</p>}
      </div>
    </li>
  );
}
