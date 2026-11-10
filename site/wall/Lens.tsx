/** The lens: chips that bring one group of cards forward and let the rest recede. */
import { type FocusEvent, type ReactElement, useEffect, useState } from "react";
import { clusterHueStyle } from "./clusters.ts";
import type { WallCard, WallLens } from "./types.ts";

export interface LensProps {
  readonly lenses: readonly WallLens[];
  /** The active lens id, or null when every card is forward. */
  readonly active: string | null;
  /** Called with a lens id, or null for "Everything". */
  readonly onSelect: (id: string | null) => void;
}

export interface LensState {
  /** The active lens, or nothing while every card is forward. */
  readonly lens: WallLens | undefined;
  /**
   * Choose a lens by id, or null for "Everything". Choosing the active lens
   * again lets it go, as pressing a pressed toggle does.
   */
  readonly select: (id: string | null) => void;
}

/** A stretch of the viewport from top to bottom, in pixels. */
export interface ViewSpan {
  readonly top: number;
  readonly bottom: number;
}

/**
 * How far the page scrolls so that a lens just chosen shows what it chose.
 *
 * `shown` is the part of the viewport the wall can be read in, under the lens
 * bar, and `forward` holds the cards the lens brought forward. While at least
 * half of one of them lies in view the answer is zero. Otherwise it is the
 * distance that brings the nearest one's top to `rest`, the line just under
 * the pinned bar, up the page or down it.
 */
export function lensTravel(
  shown: ViewSpan,
  rest: number,
  forward: readonly ViewSpan[],
): number {
  let nearest = Number.POSITIVE_INFINITY;
  for (const card of forward) {
    const inView = Math.min(card.bottom, shown.bottom) -
      Math.max(card.top, shown.top);
    if (inView * 2 >= card.bottom - card.top) return 0;
    const away = card.top - rest;
    if (Math.abs(away) < Math.abs(nearest)) nearest = away;
  }
  return Number.isFinite(nearest) ? nearest : 0;
}

/**
 * Scroll the page, once, to the nearest card the active lens brought forward
 * when none of them is in view. On a narrow screen a whole viewport can hold
 * nothing but receded cards, and a lens that shows only what it dimmed reads
 * as a dulled wall. The page scrolls as it does for any reader; no card
 * changes its place on it. Reduced motion gets the same place without the
 * travel.
 */
function showForwardCard(): void {
  const bar = document.querySelector(".wall-controls")
    ?.getBoundingClientRect();
  if (bar === undefined) return;
  const travel = lensTravel(
    { top: bar.bottom, bottom: globalThis.innerHeight },
    // The bar is pinned to the viewport's top by the time a card reaches it.
    bar.height,
    [...document.querySelectorAll(".wall-card:not([data-receded])")].map(
      (card) => card.getBoundingClientRect(),
    ),
  );
  if (travel === 0) return;
  globalThis.scrollBy({
    top: travel,
    behavior: globalThis.matchMedia("(prefers-reduced-motion: reduce)").matches
      ? "instant"
      : "smooth",
  });
}

/**
 * Hold the wall's active lens. The wall page reads `lens` to decide which
 * cards recede and passes `select` to the chips, so how a lens is chosen and
 * kept is decided here and nowhere else. Once a chosen lens has receded the
 * other cards, the page comes to one of the cards it kept forward if none is
 * in view.
 */
export function useLens(lenses: readonly WallLens[]): LensState {
  const [lensId, setLensId] = useState<string | null>(null);
  useEffect(() => {
    if (lensId !== null) showForwardCard();
  }, [lensId]);
  return {
    lens: lenses.find((candidate) => candidate.id === lensId),
    select: (id) => setLensId((was) => (was === id ? null : id)),
  };
}

/**
 * Whether a card sits outside a lens. A receded card is dimmed by the
 * stylesheet and stays in the list, in place and reachable. With no lens,
 * nothing recedes.
 */
export function lensRecedes(
  lens: WallLens | undefined,
  card: WallCard,
): boolean {
  return lens !== undefined && !lens.clusters.includes(card.cluster);
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
 * One chip per lens after "Everything". Each chip is a toggle button whose
 * `aria-pressed` states whether its lens is the active one; choosing a chip
 * only reports the choice through `onSelect`. A lens chip carries one dot per
 * cluster it gathers, in that cluster's hue, so the chips read as a key to
 * the colors on the wall. A chip that is chosen, or reached by keyboard, comes
 * to the middle of the row when the row is too long to show whole.
 */
export function Lens({ lenses, active, onSelect }: LensProps): ReactElement {
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
    </div>
  );
}
