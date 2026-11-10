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
import { deliverClick } from "./use_open_card.ts";

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
 * stands and goes to what it fell on, as `deliverClick` hands it on. The
 * later clicks of a double click are left alone, so a double click on a chip
 * chooses its lens once.
 *
 * The fade is how the change is shown, not the change. One that cannot
 * begin, or that a later one cuts short, leaves the page in its new state
 * all the same, as a cut. Only a change that itself failed is reported.
 */
async function fadeThrough(transition: ViewTransition): Promise<void> {
  const deliver = (event: MouseEvent): void => {
    if (event.detail > 1 || event.target !== document.documentElement) return;
    document.removeEventListener("click", deliver);
    transition.skipTransition();
    deliverClick(event);
  };
  document.addEventListener("click", deliver);
  const [, changed] = await Promise.allSettled([
    transition.ready,
    transition.finished,
  ]);
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
 * stands.
 */
export function useLens(lenses: readonly WallLens[]): LensState {
  const [shown, setShown] = useState<Shown>({ id: null, turn: 0 });
  const wanted = useRef<string | null>(null);
  const committing = useRef<Array<() => void>>([]);

  useEffect(() => {
    for (const committed of committing.current.splice(0)) committed();
  }, [shown]);

  const select = async (id: string | null): Promise<void> => {
    const next = wanted.current === id ? null : id;
    if (wanted.current === next) return;
    wanted.current = next;
    const sort = (): Promise<void> =>
      new Promise((sorted) => {
        showWallHead();
        committing.current.push(sorted);
        setShown((was) => ({ id: next, turn: was.turn + 1 }));
      });
    const cut = typeof document.startViewTransition !== "function" ||
      globalThis.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (cut) return await sort();
    await fadeThrough(document.startViewTransition(sort));
  };

  return {
    lens: lenses.find((candidate) => candidate.id === shown.id),
    select,
  };
}

/**
 * Bring a chip to the middle of the strip it scrolls in. Where the chips do
 * not fit one row they are a strip wider than the screen, and a chip at its
 * edge would otherwise stay half out of view. Only the strip scrolls, never
 * the page, and a strip that fits does not scroll at all.
 */
function centerChip(chip: HTMLElement): void {
  const strip = chip.parentElement;
  if (strip === null || strip.scrollWidth <= strip.clientWidth) return;
  const chipBox = chip.getBoundingClientRect();
  const stripBox = strip.getBoundingClientRect();
  strip.scrollTo({
    left: strip.scrollLeft + chipBox.left - stripBox.left -
      (stripBox.width - chipBox.width) / 2,
  });
}

/**
 * Center a chip the keyboard has just reached. A pointer's press focuses a
 * chip too, and moving the chip under the pointer then would lose the click,
 * so a chip focused by pointer stays put until it is chosen.
 */
function centerOnKeyboardFocus(event: FocusEvent<HTMLButtonElement>): void {
  if (event.currentTarget.matches(":focus-visible")) {
    centerChip(event.currentTarget);
  }
}

/**
 * One chip per lens after "Everything", and the lens's status. Each chip is a
 * toggle button whose `aria-pressed` states whether its lens is the active
 * one; choosing a chip only reports the choice through `onSelect`. A lens chip
 * carries one dot per cluster it gathers, in that cluster's hue, so the chips
 * read as a key to the colors on the wall. A chip that is chosen, or reached
 * by keyboard, comes to the middle of the row when the row is too long to
 * show whole.
 *
 * The status is a live region that is never drawn. It is in the server's
 * markup, empty, so assistive technology is already listening when a lens
 * first fills it.
 */
export function Lens(
  { lenses, active, status, onSelect }: LensProps,
): ReactElement {
  return (
    <div
      className="wall-lens"
      role="group"
      aria-label="Show the cards that matter to you"
    >
      <button
        type="button"
        className="wall-chip"
        aria-pressed={active === null}
        onFocus={centerOnKeyboardFocus}
        onClick={(event) => {
          centerChip(event.currentTarget);
          onSelect(null);
        }}
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
          onClick={(event) => {
            centerChip(event.currentTarget);
            onSelect(lens.id);
          }}
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
      <p className="wall-lens-status" role="status">{status}</p>
    </div>
  );
}
