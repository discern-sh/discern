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

/**
 * The attribute the page's root carries while a sheet's view transition is
 * past its first picture: from the moment the page changes until the
 * transition ends. The stylesheet takes the root's transition name away for
 * as long, so the browser pictures the page as it stood and never as it
 * stands, and that one picture fades out over the page itself. Its value is
 * the request that set it.
 */
export const SHEET_MOVING_ATTRIBUTE = "data-wall-sheet-moving";

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

/** The viewport's size, in pixels. */
function viewportSize(): BoxSize {
  return { width: globalThis.innerWidth, height: globalThis.innerHeight };
}

/** What is known when a view transition fails to begin. */
export interface TransitionEnd {
  /** The reason the browser gave for ending it. */
  readonly reason: unknown;
  /** The page is hidden. */
  readonly hidden: boolean;
  /** The viewport has changed size since the transition was asked for. */
  readonly resized: boolean;
}

/**
 * Whether a view transition failed to begin for an expected reason. The page
 * still reaches the state that was asked for, so there is nothing to report.
 *
 * - A hidden page runs no transition.
 * - A later request ends an earlier transition, which the browser calls an
 *   abort.
 * - A viewport that changes size as the transition starts, when a window is
 *   resized or a phone turned, ends it as an invalid state.
 *
 * Any other reason is a fault. An invalid state with the viewport unchanged
 * is how the browser reports a transition name that stands on two boxes.
 */
export function transitionOvertaken(end: TransitionEnd): boolean {
  if (end.hidden) return true;
  if (!(end.reason instanceof DOMException)) return false;
  return end.reason.name === "AbortError" ||
    (end.resized && end.reason.name === "InvalidStateError");
}

/** The parts of a click that say whether it is a plain one. */
export type ClickKind = Pick<
  MouseEvent,
  "button" | "ctrlKey" | "metaKey" | "shiftKey" | "altKey"
>;

/**
 * Whether a click is the plain kind: the primary button, with no modifier
 * key held. Any other click asks the browser for something of its own, such
 * as a link opened in a new tab, which a click made by script cannot carry.
 */
export function plainClick(click: ClickKind): boolean {
  return click.button === 0 &&
    !(click.ctrlKey || click.metaKey || click.shiftKey || click.altKey);
}

/**
 * Hand a click to what it fell on, as the browser would have: the link or
 * button there takes focus and the click. Where it fell on a sheet's words,
 * the sheet takes the focus, as it does for a press on them once it rests.
 * This is for a click the browser kept from the page, and it reads the page
 * as it stands when called. Only a plain click is handed on. The click made
 * here is a new one that keeps no modifier key and no button, so any other
 * click is dropped, and the visitor makes it again on a page that answers
 * for itself.
 */
export function deliverClick(event: MouseEvent): void {
  if (!plainClick(event)) return;
  const under = document.elementFromPoint(event.clientX, event.clientY);
  const control = under?.closest<HTMLElement>("a[href], button") ?? null;
  const holder = control ?? under?.closest<HTMLElement>("dialog");
  holder?.focus({ preventScroll: true });
  const target = control ?? under;
  if (target instanceof HTMLElement) target.click();
}

/**
 * Whether a pointer event fell outside a box, by its place alone. While a
 * view transition runs, the browser hands a pointer event to the document's
 * root, or to an arriving sheet's dialog, wherever it fell. Then only its
 * place can say what it was aimed at.
 */
export function fellOutside(box: DOMRectReadOnly, event: MouseEvent): boolean {
  return event.clientX < box.left || event.clientX > box.right ||
    event.clientY < box.top || event.clientY > box.bottom;
}

/**
 * Keep a double click to one act. A double click is a sequence of clicks,
 * which each click counts in its `detail`, and the later ones land wherever
 * the first has left the page: on a link in the sheet it opened, on the card
 * under a sheet it closed, or on the chip it has just pressed. Once a click
 * has changed the wall, the sequence it belongs to is spent, and the rest of
 * it is dropped before anything on the page hears it. The press that begins
 * a dropped click does nothing either, so the focus stays with the sheet or
 * the card the first click gave it to. A click that starts a sequence of its
 * own is heard as usual.
 *
 * Returns the function that marks the sequence under way as spent. Whatever
 * changes the wall calls it as the change is asked for.
 */
export function useClickSequence(): () => void {
  const spent = useRef(false);
  useEffect(() => {
    const press = (event: MouseEvent): void => {
      if (event.detail > 1 && spent.current) event.preventDefault();
    };
    const hear = (event: MouseEvent): void => {
      if (event.detail <= 1) {
        spent.current = false;
      } else if (spent.current) {
        event.stopPropagation();
        event.preventDefault();
      }
    };
    document.addEventListener("mousedown", press, true);
    document.addEventListener("click", hear, true);
    return () => {
      document.removeEventListener("mousedown", press, true);
      document.removeEventListener("click", hear, true);
    };
  }, []);
  return () => {
    spent.current = true;
  };
}

/** The view transition `beginTransition` last began, until it has ended. */
let running: ViewTransition | null = null;

/**
 * Whether a view transition begun here is under way: from the moment it is
 * asked for until `transitionEnded` has seen it end. For that long the
 * browser draws the page from pictures, and what changes on the page under
 * them is drawn again on every frame and seen by nobody. The pointer light
 * reads this, and holds still.
 */
export function transitionRunning(): boolean {
  return running !== null;
}

/**
 * Begin a view transition around a change to the page. A browser that
 * refuses to begin one throws. The refusal is reported, and the answer is
 * null: the caller then makes the change as a cut, so the page still reaches
 * the state that was asked for.
 *
 * Every view transition on the site begins here, and its caller waits for it
 * through `transitionEnded`. The two together are what `transitionRunning`
 * answers from.
 */
export function beginTransition(
  change: () => Promise<void>,
): ViewTransition | null {
  try {
    const transition = document.startViewTransition(change);
    running = transition;
    return transition;
  } catch (refusal) {
    reportError(refusal);
    return null;
  }
}

/**
 * Wait for a view transition to end, however it ends, and answer with how it
 * began and how it finished. A transition a later one has overtaken ends
 * here too, and leaves the later one running.
 */
export async function transitionEnded(
  transition: ViewTransition,
): Promise<
  [began: PromiseSettledResult<void>, finished: PromiseSettledResult<void>]
> {
  const ends = await Promise.allSettled([
    transition.ready,
    transition.finished,
  ]);
  if (running === transition) running = null;
  return ends;
}

/** The sheet's dialog while a card is open: the modal layer over the page. */
function modalSheet(): Element | null {
  return document.querySelector("dialog:modal");
}

/** A view transition of the open card that is under way. */
interface Moving {
  readonly transition: ViewTransition;
  /** A sheet is arriving. Otherwise one is leaving. */
  readonly arriving: boolean;
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
 * While a sheet's view transition runs, the browser hands a click to nothing
 * the visitor sees. As the sheet arrives, the page behind it is inert and
 * the sheet's face is drawn from the transition's pictures, so every click
 * lands on the dialog itself. As the sheet leaves, the page's old picture
 * lies over the page, and every click lands on the document's root. Such a
 * click ends the transition where it stands and goes to what it fell on:
 *
 * - While the sheet arrives, a click inside its box reaches the control
 *   there, so the close control and the link answer from the moment the
 *   sheet is drawn. A click outside the box asks to leave, and the sheet
 *   reads that one itself.
 * - Once the sheet is on its way out the page is the visitor's again, and a
 *   click anywhere reaches what lies under it.
 *
 * A click with a modifier key held, or with any button but the primary one,
 * ends the transition and goes nowhere: see `deliverClick`. A double click
 * that opens or closes a card stops there: see `useClickSequence`.
 */
export function useOpenCard(deck: readonly WallCard[]): OpenCardState {
  const [shown, setShown] = useState<Shown>({ id: null, turn: 0 });
  const wanted = useRef<string | null>(null);
  const turns = useRef(0);
  const marked = useRef<HTMLElement | null>(null);
  const committing = useRef<Array<() => void>>([]);
  const moving = useRef<Moving | null>(null);
  const spend = useClickSequence();

  useEffect(() => {
    for (const committed of committing.current.splice(0)) committed();
  }, [shown]);
  useEffect(() => () => marked.current?.removeAttribute(OPENING_ATTRIBUTE), []);
  useEffect(() => {
    const deliver = (event: MouseEvent): void => {
      const running = moving.current;
      if (running === null) return;
      const sheet = running.arriving ? modalSheet() : null;
      if (
        event.target !== document.documentElement && event.target !== sheet
      ) return;
      if (
        running.arriving &&
        (sheet === null || fellOutside(sheet.getBoundingClientRect(), event))
      ) return;
      moving.current = null;
      running.transition.skipTransition();
      deliverClick(event);
    };
    // A click of any button but the primary one arrives as `auxclick`.
    document.addEventListener("click", deliver);
    document.addEventListener("auxclick", deliver);
    return () => {
      document.removeEventListener("click", deliver);
      document.removeEventListener("auxclick", deliver);
    };
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
    spend();
    turns.current += 1;
    const turn = turns.current;
    const asked = viewportSize();
    const source = cardElement(next ?? was);
    const how = openChange({
      transitions: typeof document.startViewTransition === "function",
      reducedMotion:
        globalThis.matchMedia("(prefers-reduced-motion: reduce)").matches,
      sourceFlat: liesFlat(source),
      swap: was !== null && next !== null,
    });
    const morphs = how === "morph";
    const commit = (grown: boolean): Promise<void> =>
      new Promise((committed) => {
        mark(source, grown ? (next === null ? "morph" : "held") : undefined);
        committing.current.push(committed);
        setShown({ id: next, turn });
      });
    if (how === "cut") return await commit(false);
    if (morphs && next !== null) mark(source, "morph");
    const page = document.documentElement;
    const transition = beginTransition(() => {
      // A request that a later one has overtaken still makes its change, and
      // makes it before the later transition takes its first picture. Only
      // the latest request marks the root, or that picture would lack the
      // page.
      if (turns.current === turn) {
        page.setAttribute(SHEET_MOVING_ATTRIBUTE, String(turn));
      }
      return commit(morphs);
    });
    if (transition === null) return await commit(false);
    moving.current = { transition, arriving: next !== null };
    const [began] = await transitionEnded(transition);
    if (moving.current?.transition === transition) moving.current = null;
    if (page.getAttribute(SHEET_MOVING_ATTRIBUTE) === String(turn)) {
      page.removeAttribute(SHEET_MOVING_ATTRIBUTE);
    }
    if (began.status === "rejected") {
      const now = viewportSize();
      const overtaken = transitionOvertaken({
        reason: began.reason,
        hidden: document.visibilityState === "hidden",
        resized: now.width !== asked.width || now.height !== asked.height,
      });
      if (!overtaken) reportError(began.reason);
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
