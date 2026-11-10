/** The lens: chips that bring one group of cards forward and let the rest recede. */
import { type FocusEvent, type ReactElement, useState } from "react";
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

/**
 * Hold the wall's active lens. The wall page reads `lens` to decide which
 * cards recede and passes `select` to the chips, so how a lens is chosen and
 * kept is decided here and nowhere else.
 */
export function useLens(lenses: readonly WallLens[]): LensState {
  const [lensId, setLensId] = useState<string | null>(null);
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
