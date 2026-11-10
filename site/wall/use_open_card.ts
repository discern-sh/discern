/** Which card is open, and how one opens and closes. */
import { useState } from "react";
import type { WallCard } from "./types.ts";

export interface OpenCardState {
  /** The open card, or null while none is open. */
  readonly card: WallCard | null;
  /** Open the card with this id. An id outside the deck opens nothing. */
  readonly open: (id: string) => void;
  /** Record that the open card has closed. */
  readonly close: () => void;
}

/**
 * Hold the wall's one open card. The wall page passes `open` to every card
 * and hands `card` and `close` to the opened-card dialog, so how a card opens
 * is decided here and nowhere else.
 */
export function useOpenCard(deck: readonly WallCard[]): OpenCardState {
  const [openId, setOpenId] = useState<string | null>(null);
  return {
    card: deck.find((card) => card.id === openId) ?? null,
    open: setOpenId,
    close: () => setOpenId(null),
  };
}
