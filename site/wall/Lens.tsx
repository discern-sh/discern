/**
 * The lens: chips that bring one group of cards to the head of the wall and
 * set the rest aside under a divider.
 */
import {
  type FocusEvent,
  type ReactElement,
  useEffect,
  useRef,
  useState,
} from "react";
import { clusterHueStyle } from "./clusters.ts";
import type { WallCard, WallLens } from "./types.ts";
import {
  beginTransition,
  deliverClick,
  transitionEnded,
  transitionRunning,
  useClickSequence,
} from "./use_open_card.ts";

export interface LensProps {
  readonly lenses: readonly WallLens[];
  /** The active lens id, or null when every card is forward. */
  readonly active: string | null;
  /** What the active lens did to the wall, in words: see `lensStatus`. */
  readonly status: string;
  /** Called with a lens id, or null for "Everything". */
  readonly onSelect: (id: string | null) => void;
}

export interface LensState {
  /** The active lens, or nothing while every card is forward. */
  readonly lens: WallLens | undefined;
  /**
   * Choose a lens by id, or null for "Everything". Choosing the active lens
   * again lets it go, as pressing a pressed toggle does. The promise settles
   * once the wall shows the choice.
   */
  readonly select: (id: string | null) => Promise<void>;
}

/** The words on the divider between the cards a lens kept and the rest. */
export const LENS_REST = "Everything else";

/**
 * Whether a card sits outside a lens. A receded card is set aside under the
 * divider and dimmed by the stylesheet. It stays in the list, where it can
 * still be read, focused, and opened. With no lens, nothing recedes.
 */
export function lensRecedes(
  lens: WallLens | undefined,
  card: WallCard,
): boolean {
  return lens !== undefined && !lens.clusters.includes(card.cluster);
}

/** The wall as a lens orders it. */
export interface LensGroups {
  /** The cards the lens kept, which lead the wall: all of them with no lens. */
  readonly kept: readonly WallCard[];
  /** The cards it set aside, which follow the divider. */
  readonly rest: readonly WallCard[];
}

/**
 * Split a deck into the cards a lens keeps and the cards it sets aside. Each
 * group keeps the deck's own order, so with no lens the wall is the deck.
 */
export function lensGroups(
  lens: WallLens | undefined,
  deck: readonly WallCard[],
): LensGroups {
  return {
    kept: deck.filter((card) => !lensRecedes(lens, card)),
    rest: deck.filter((card) => lensRecedes(lens, card)),
  };
}

/**
 * What a lens did to the wall, in words, for a reader who cannot see the
 * cards regroup. Empty with no lens.
 */
export function lensStatus(
  lens: WallLens | undefined,
  { kept, rest }: LensGroups,
): string {
  if (lens === undefined) return "";
  const found = `${kept.length} ${
    kept.length === 1 ? "card" : "cards"
  } for "${lens.label}".`;
  if (rest.length === 0) return found;
  const others = rest.length === 1
    ? "The other card follows"
    : `The other ${rest.length} follow`;
  return `${found} ${others} under "${LENS_REST}".`;
}

/**
 * Bring a reader who has scrolled down the wall back to its head, where the
 * cards a lens kept now are. The jump is immediate. A reader who can already
 * see the head of the wall is left where they are.
 */
function showWallHead(): void {
  const top = document.querySelector(".wall-stage")?.getBoundingClientRect()
    .top;
  if (top !== undefined && top < 0) {
    globalThis.scrollBy({ top, behavior: "instant" });
  }
}

/**
 * Wait out a cross-fade of the page, and keep the page the visitor's while
 * it runs. The browser tests nothing on the page for a hit during a view
 * transition: every click lands on the document's root. The page is already
 * in its new state by then, so the first such click ends the fade where it
 * stands and goes to what it fell on, as `deliverClick` hands it on.
 *
 * The fade is how the change is shown, not the change. One that cannot
 * begin, or that a later one cuts short, leaves the page in its new state
 * all the same, as a cut. Only a change that itself failed is reported.
 */
async function fadeThrough(transition: ViewTransition): Promise<void> {
  const deliver = (event: MouseEvent): void => {
    if (event.target !== document.documentElement) return;
    document.removeEventListener("click", deliver);
    transition.skipTransition();
    deliverClick(event);
  };
  document.addEventListener("click", deliver);
  const [, changed] = await transitionEnded(transition);
  document.removeEventListener("click", deliver);
  if (changed.status === "rejected") reportError(changed.reason);
}

/** The lens the wall shows, and which request put it there. */
interface Shown {
  readonly id: string | null;
  readonly turn: number;
}

/**
 * Hold the wall's active lens. The wall page reads `lens` to order the cards
 * and passes `select` to the chips, so how a lens is chosen and kept is
 * decided here and nowhere else.
 *
 * A lens re-sorts the wall, and no card is seen to travel. Where the browser
 * has view transitions and the visitor has not asked for reduced motion, the
 * page cross-fades once from the one order to the other. Otherwise the change
 * is a cut. In the same frame the page comes back to the head of the wall if
 * the reader had scrolled past it.
 *
 * Each request states the lens the wall should end with, so however requests
 * overlap, the last one wins: a later cross-fade ends an earlier one where it
 * stands. A double click on a chip chooses its lens once, and does not let
 * it go again: see `useClickSequence`.
 */
export function useLens(lenses: readonly WallLens[]): LensState {
  const [shown, setShown] = useState<Shown>({ id: null, turn: 0 });
  const wanted = useRef<string | null>(null);
  const committing = useRef<Array<() => void>>([]);
  const spend = useClickSequence();

  useEffect(() => {
    for (const committed of committing.current.splice(0)) committed();
  }, [shown]);

  const select = async (id: string | null): Promise<void> => {
    const next = wanted.current === id ? null : id;
    if (wanted.current === next) return;
    wanted.current = next;
    spend();
    const sort = (): Promise<void> =>
      new Promise((sorted) => {
        showWallHead();
        committing.current.push(sorted);
        setShown((was) => ({ id: next, turn: was.turn + 1 }));
      });
    const cut = typeof document.startViewTransition !== "function" ||
      globalThis.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (cut) return await sort();
    const fade = beginTransition(sort);
    if (fade === null) return await sort();
    await fadeThrough(fade);
  };

  return {
    lens: lenses.find((candidate) => candidate.id === shown.id),
    select,
  };
}

/** A stretch of the chip row along its line, in pixels from the row's start. */
export interface RowStretch {
  readonly start: number;
  readonly end: number;
}

/** Where the chip row's strip stands, in pixels. */
export interface StripView {
  /** How far the strip has scrolled from the row's start. */
  readonly scroll: number;
  /** How much of the row the strip shows at once. */
  readonly client: number;
  /** How long the whole row is. */
  readonly extent: number;
  /**
   * How far in from each side of the strip a chip is clear of its fade. A
   * chip inside that is fully in view.
   */
  readonly clear: number;
}

/** Which sides of the strip have more of the row past them. */
export interface StripEdges {
  readonly start: boolean;
  readonly end: boolean;
}

/** A scroll the strip can reach: from the row's start to its end. */
function withinStrip(view: StripView, scroll: number): number {
  return Math.min(Math.max(scroll, 0), Math.max(view.extent - view.client, 0));
}

/**
 * Which sides of the strip have more to scroll to. A strip less than a pixel
 * from its end counts as at its end: a scroll can stop a fraction short.
 */
export function stripEdges(view: StripView): StripEdges {
  return {
    start: view.scroll >= 1,
    end: view.scroll + view.client <= view.extent - 1,
  };
}

/**
 * The scroll that brings a chip to the middle of the strip. A chip wider than
 * the strip's clear span lines its start up with that span's start instead,
 * so it is shown as fully as it can be.
 */
export function centeredScroll(view: StripView, chip: RowStretch): number {
  const span = view.client - 2 * view.clear;
  const target = chip.end - chip.start > span
    ? chip.start - view.clear
    : (chip.start + chip.end - view.client) / 2;
  return withinStrip(view, target);
}

/**
 * The scroll one step toward a side brings. The first chip that side cuts
 * comes to the opposite side of the clear span, so each step shows a fresh
 * run of chips and the chip that was cut is whole. A chip wider than the
 * clear span shows its far end instead, so a step always moves the strip.
 */
export function steppedScroll(
  view: StripView,
  chips: readonly RowStretch[],
  side: keyof StripEdges,
): number {
  const clearStart = view.scroll + view.clear;
  const clearEnd = view.scroll + view.client - view.clear;
  if (side === "end") {
    const cut = chips.find((chip) => chip.end > clearEnd + 1);
    if (cut === undefined) return withinStrip(view, view.extent);
    const leading = cut.start - view.clear;
    return withinStrip(
      view,
      leading > view.scroll ? leading : cut.end - view.client + view.clear,
    );
  }
  const cut = chips.findLast((chip) => chip.start < clearStart - 1);
  if (cut === undefined) return 0;
  const trailing = cut.end - view.client + view.clear;
  return withinStrip(
    view,
    trailing < view.scroll ? trailing : cut.start - view.clear,
  );
}

/** Where a strip stands now. Its scroll padding is the width of its fade. */
function viewOf(strip: HTMLElement): StripView {
  return {
    scroll: strip.scrollLeft,
    client: strip.clientWidth,
    extent: strip.scrollWidth,
    clear: parseFloat(getComputedStyle(strip).scrollPaddingInlineStart) || 0,
  };
}

/** Where a chip lies along its strip's row. */
function stretchOf(strip: HTMLElement, chip: Element): RowStretch {
  const box = chip.getBoundingClientRect();
  const from = strip.getBoundingClientRect().left - strip.scrollLeft;
  return { start: box.left - from, end: box.right - from };
}

/**
 * Scroll the strip alone, never the page. While a cross-fade shows a change,
 * the strip jumps, so the fade's new picture already shows it where it ends.
 * Otherwise the stylesheet decides: a glide, or a jump under reduced motion.
 */
function scrollStrip(strip: HTMLElement, left: number): void {
  if (Math.abs(left - strip.scrollLeft) < 1) return;
  strip.scrollTo({ left, behavior: transitionRunning() ? "instant" : "auto" });
}

/** Bring a chip to the middle of its strip. */
function centerChip(strip: HTMLElement, chip: Element): void {
  scrollStrip(strip, centeredScroll(viewOf(strip), stretchOf(strip, chip)));
}

/**
 * Center a chip the keyboard has just reached. A pointer's press focuses a
 * chip too, and moving the chip under the pointer then would lose the click,
 * so a chip focused by pointer stays put until it is chosen.
 */
function centerOnKeyboardFocus(event: FocusEvent<HTMLButtonElement>): void {
  const chip = event.currentTarget;
  const strip = chip.parentElement;
  if (strip !== null && chip.matches(":focus-visible")) centerChip(strip, chip);
}

/** No edge has more to show: how the strip renders before it is measured. */
const NO_EDGES: StripEdges = { start: false, end: false };

/** The words that name each step control. */
export const STEP_NAMES: Readonly<Record<keyof StripEdges, string>> = {
  start: "Scroll back through the lenses",
  end: "Scroll on through the lenses",
};

/**
 * One chip per lens after "Everything", and the lens's status. Each chip is a
 * toggle button whose `aria-pressed` states whether its lens is the active
 * one; choosing a chip only reports the choice through `onSelect`. A lens chip
 * carries one dot per cluster it gathers, in that cluster's hue, so the chips
 * read as a key to the colors on the wall.
 *
 * Where the row is too long to show whole, its strip scrolls sideways. The
 * active chip, however it became active, and a chip the keyboard reaches come
 * to the middle of the strip. A side with more past it fades, and carries a
 * step control for a pointer, which has no other way to scroll a strip whose
 * scrollbar is not drawn. The edges are measured once the page is live and
 * whenever the strip scrolls or changes size, so the server's markup and the
 * browser's first render agree: neither fades nor steps.
 *
 * The step controls are for the pointer alone. The keyboard reaches every
 * chip by moving the focus, so they are out of the tab order, and a press on
 * one leaves the focus where it was.
 *
 * The status is a live region that is never drawn. It is in the server's
 * markup, empty, so assistive technology is already listening when a lens
 * first fills it.
 */
export function Lens(
  { lenses, active, status, onSelect }: LensProps,
): ReactElement {
  const strip = useRef<HTMLDivElement>(null);
  const [edges, setEdges] = useState<StripEdges>(NO_EDGES);

  const measure = (): void => {
    if (strip.current === null) return;
    const next = stripEdges(viewOf(strip.current));
    setEdges((was) =>
      was.start === next.start && was.end === next.end ? was : next
    );
  };

  useEffect(() => {
    const row = strip.current;
    if (row === null) return;
    measure();
    const resized = new ResizeObserver(measure);
    resized.observe(row);
    for (const chip of row.children) resized.observe(chip);
    return () => resized.disconnect();
  }, []);

  useEffect(() => {
    const row = strip.current;
    const chip = row?.querySelector('[aria-pressed="true"]');
    if (row && chip) centerChip(row, chip);
  }, [active]);

  const step = (side: keyof StripEdges): void => {
    const row = strip.current;
    if (row === null) return;
    const chips = [...row.children].map((chip) => stretchOf(row, chip));
    scrollStrip(row, steppedScroll(viewOf(row), chips, side));
  };

  const stepControl = (side: keyof StripEdges): ReactElement => (
    <button
      type="button"
      className="wall-lens-step"
      data-side={side}
      aria-label={STEP_NAMES[side]}
      tabIndex={-1}
      hidden={!edges[side]}
      onMouseDown={(event) => event.preventDefault()}
      onClick={() => step(side)}
    />
  );

  return (
    <div
      className="wall-lens"
      role="group"
      aria-label="Show the cards that matter to you"
    >
      <div
        ref={strip}
        className="wall-lens-strip"
        data-more-start={edges.start ? "" : undefined}
        data-more-end={edges.end ? "" : undefined}
        onScroll={measure}
      >
        <button
          type="button"
          className="wall-chip"
          aria-pressed={active === null}
          onFocus={centerOnKeyboardFocus}
          onClick={() => onSelect(null)}
        >
          Everything
        </button>
        {lenses.map((lens) => (
          <button
            key={lens.id}
            type="button"
            className="wall-chip"
            data-lens={lens.id}
            aria-pressed={active === lens.id}
            onFocus={centerOnKeyboardFocus}
            onClick={() => onSelect(lens.id)}
          >
            <span className="wall-chip-hues" aria-hidden="true">
              {lens.clusters.map((cluster) => (
                <span
                  key={cluster}
                  className="wall-chip-hue"
                  style={clusterHueStyle(cluster)}
                />
              ))}
            </span>
            {lens.label}
          </button>
        ))}
      </div>
      {stepControl("start")}
      {stepControl("end")}
      <p className="wall-lens-status" role="status">{status}</p>
    </div>
  );
}
