/** Which card is open, and how one opens and closes. */
import { useEffect, useRef, useState } from "react";
import type { WallCard } from "./types.ts";

export interface OpenCardState {
  /** The open card, or null while none is open. */
  readonly card: WallCard | null;
  /**
   * Open the card with this id. An id outside the deck opens nothing. The
   * promise settles once the page has finished changing.
   */
  readonly open: (id: string) => Promise<void>;
  /** Close the open card. The promise settles once the page has finished changing. */
  readonly close: () => Promise<void>;
}

/**
 * The attribute a card's list item carries while it is the opened card's
 * source, and the two states the stylesheet styles:
 *
 * - `morph`: the card shares the sheet's view-transition name, so the browser
 *   grows the one into the other. It holds this state only across a morph.
 * - `held`: the card has become the sheet. It keeps its place in the wall,
 *   unseen, until the sheet returns to it.
 */
export const OPENING_ATTRIBUTE = "data-wall-opening";
export const OPENING_STATES = ["morph", "held"] as const;
type OpeningState = (typeof OPENING_STATES)[number];

/** How the page gets from one open-card state to the next. */
export type OpenChange = "morph" | "fade" | "cut";

/** What decides how a card opens or closes, read as the change is asked for. */
export interface OpenChangeFacts {
  /** The browser can run a view transition. */
  readonly transitions: boolean;
  /** The visitor asked for reduced motion. */
  readonly reducedMotion: boolean;
  /**
   * The card the sheet grows from or returns to is on the page and lies flat:
   * nothing has tilted or scaled it, as the far view does.
   */
  readonly sourceFlat: boolean;
  /** One open card is giving way to another, with no closed state between. */
  readonly swap: boolean;
}

/**
 * Choose how a card opens or closes.
 *
 * - `morph`: the card grows into the sheet, or the sheet shrinks back into it.
 * - `fade`: the sheet fades in or out where it stands. A tilted card would
 *   make a poor start for a morph, and a swap has no card to grow from.
 * - `cut`: the change is immediate, with at most the stylesheet's short fade.
 *   Reduced motion and browsers without view transitions get this.
 */
export function openChange(facts: OpenChangeFacts): OpenChange {
  if (!facts.transitions || facts.reducedMotion) return "cut";
  return facts.sourceFlat && !facts.swap ? "morph" : "fade";
}

/** The list item of the card with this id, if the wall holds one. */
function cardElement(id: string | null): HTMLElement | null {
  for (const item of document.querySelectorAll(".wall-card")) {
    if (item instanceof HTMLElement && item.dataset.card === id) return item;
  }
  return null;
}

/** The width and height of a box, in pixels. */
export interface BoxSize {
  readonly width: number;
  readonly height: number;
}

/**
 * How far a card's drawn box may differ from its laid-out box, in pixels, and
 * still count as flat. The laid-out size is snapped to whole pixels at the
 * card's place on the page and the drawn size is not, so a flat card can
 * differ by anything short of a pixel.
 */
const FLAT_WITHIN = 1;

/**
 * Whether a box is drawn at the size it was laid out at. Any tilt or scale on
 * the plane a card lies on changes its drawn box, so this is how a card is
 * known to lie flat on the page.
 */
export function drawnFlat(drawn: BoxSize, laidOut: BoxSize): boolean {
  return Math.abs(drawn.width - laidOut.width) < FLAT_WITHIN &&
    Math.abs(drawn.height - laidOut.height) < FLAT_WITHIN;
}

/** Whether a card is on the page and lies flat on it. */
function liesFlat(card: HTMLElement | null): boolean {
  return card !== null &&
    drawnFlat(card.getBoundingClientRect(), {
      width: card.offsetWidth,
      height: card.offsetHeight,
    });
}

/**
 * Whether a view transition failed to begin for the one expected reason: a
 * later request, or a hidden page, ended it first. The page still reaches the
 * state that was asked for, so there is nothing to report. Any other reason
 * is a fault.
 */
function overtaken(reason: unknown): boolean {
  return document.visibilityState === "hidden" ||
    (reason instanceof DOMException && reason.name === "AbortError");
}

/**
 * Hand a click to what it fell on, as the browser would have: the link or
 * button there takes focus and the click. This is for a click the browser
 * kept from the page, and it reads the page as it stands when called.
 */
function deliverClick(event: MouseEvent): void {
  const under = document.elementFromPoint(event.clientX, event.clientY);
  const control = under?.closest<HTMLElement>("a[href], button") ?? null;
  control?.focus({ preventScroll: true });
  const target = control ?? under;
  if (target instanceof HTMLElement) target.click();
}

/** What the wall shows open, and which request put it there. */
interface Shown {
  readonly id: string | null;
  readonly turn: number;
}

/**
 * Hold the wall's one open card, and carry every change of it. The wall page
 * passes `open` to every card and hands `card` and `close` to the opened-card
 * dialog, so how a card opens and closes is decided here and nowhere else.
 *
 * Each request states where the wall should end up, so however requests
 * overlap, the last one wins and the page is never left between states:
 *
 * - A request for what is already wanted does nothing.
 * - A view transition waits for React to commit the request before the
 *   browser looks at the page again, and a later request ends an earlier
 *   transition where it stands.
 * - At most one card carries the opening attribute, and the last close to
 *   finish removes it.
 *
 * While a view transition runs, the browser tests nothing on the page for a
 * hit: every click lands on the document's root. The sheet reads such a click
 * itself while it is open. Once it is on its way out the page is the
 * visitor's again, so a click made then ends the transition where it stands
 * and goes to what it fell on. The later clicks of a double click are left
 * alone: a double click that dismisses the sheet must not also press the card
 * that lies under it.
 */
export function useOpenCard(deck: readonly WallCard[]): OpenCardState {
  const [shown, setShown] = useState<Shown>({ id: null, turn: 0 });
  const wanted = useRef<string | null>(null);
  const turns = useRef(0);
  const marked = useRef<HTMLElement | null>(null);
  const committing = useRef<Array<() => void>>([]);
  const leaving = useRef<ViewTransition | null>(null);

  useEffect(() => {
    for (const committed of committing.current.splice(0)) committed();
  }, [shown]);
  useEffect(() => () => marked.current?.removeAttribute(OPENING_ATTRIBUTE), []);
  useEffect(() => {
    const deliver = (event: MouseEvent): void => {
      const transition = leaving.current;
      if (transition === null || event.detail > 1) return;
      if (event.target !== document.documentElement) return;
      leaving.current = null;
      transition.skipTransition();
      deliverClick(event);
    };
    document.addEventListener("click", deliver);
    return () => document.removeEventListener("click", deliver);
  }, []);

  const mark = (card: HTMLElement | null, state?: OpeningState): void => {
    if (marked.current !== card) {
      marked.current?.removeAttribute(OPENING_ATTRIBUTE);
    }
    if (state === undefined) card?.removeAttribute(OPENING_ATTRIBUTE);
    else card?.setAttribute(OPENING_ATTRIBUTE, state);
    marked.current = state === undefined ? null : card;
  };

  const change = async (next: string | null): Promise<void> => {
    const was = wanted.current;
    if (was === next) return;
    wanted.current = next;
    turns.current += 1;
    const turn = turns.current;
    const source = cardElement(next ?? was);
    const how = openChange({
      transitions: typeof document.startViewTransition === "function",
      reducedMotion:
        globalThis.matchMedia("(prefers-reduced-motion: reduce)").matches,
      sourceFlat: liesFlat(source),
      swap: was !== null && next !== null,
    });
    const morphs = how === "morph";
    const commit = (): Promise<void> =>
      new Promise((committed) => {
        mark(source, morphs ? (next === null ? "morph" : "held") : undefined);
        committing.current.push(committed);
        setShown({ id: next, turn });
      });
    if (how === "cut") return await commit();
    if (morphs && next !== null) mark(source, "morph");
    const transition = document.startViewTransition(commit);
    leaving.current = next === null ? transition : null;
    const [began] = await Promise.allSettled([
      transition.ready,
      transition.finished,
    ]);
    if (leaving.current === transition) leaving.current = null;
    if (began.status === "rejected" && !overtaken(began.reason)) {
      reportError(began.reason);
    }
    if (next === null && turns.current === turn) mark(null);
  };

  return {
    card: deck.find((card) => card.id === shown.id) ?? null,
    open: (id) =>
      deck.some((card) => card.id === id) ? change(id) : Promise.resolve(),
    close: () => change(null),
  };
}
