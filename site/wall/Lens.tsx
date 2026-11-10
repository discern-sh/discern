/** The lens: chips that bring one group of cards forward and let the rest recede. */
import type { ReactElement } from "react";
import type { WallCard, WallLens } from "./types.ts";

export interface LensProps {
  readonly lenses: readonly WallLens[];
  /** The active lens id, or null when every card is forward. */
  readonly active: string | null;
  /** Called with a lens id, or null for "Everything". */
  readonly onSelect: (id: string | null) => void;
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
 * One chip per lens after "Everything". Each chip is a toggle button whose
 * `aria-pressed` states whether its lens is the active one; choosing a chip
 * only reports the choice through `onSelect`.
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
          onClick={() => onSelect(lens.id)}
        >
          {lens.label}
        </button>
      ))}
    </div>
  );
}
