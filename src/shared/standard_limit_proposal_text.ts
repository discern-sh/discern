/**
 * How one standard limit proposal's numbers read. The Proof page, the
 * acceptance refusal, the proposal result, and the proposal commit all state
 * the same decision, so they share this one sentence fragment. A leaf, so any
 * surface can render it without the gate's module graph.
 */

/** The numbers an owner decides on. `margin` is absent when the standard
 * keeps none, and the proposed limit is then the measurement itself. */
export interface StandardLimitProposalFigures {
  readonly trunk_limit: number;
  readonly proposed_limit: number;
  readonly measurement: number;
  readonly margin?: number | undefined;
  readonly delta: number;
}

/** The margin a proposal keeps as headroom; none reads as zero. */
export function standardLimitProposalMargin(
  proposal: Pick<StandardLimitProposalFigures, "margin">,
): number {
  return proposal.margin ?? 0;
}

/**
 * The move and what it rests on, for example
 * `1000 → 1090 (measured 1040; margin 50; delta +90)`. The measurement, the
 * margin kept as headroom, and the resulting limit stay separate so the owner
 * sees how much of the move the change demonstrated. The delta is signed
 * against the trunk limit.
 */
export function standardLimitProposalFigures(
  proposal: StandardLimitProposalFigures,
): string {
  const margin = proposal.margin === undefined
    ? ""
    : `margin ${proposal.margin}; `;
  return `${proposal.trunk_limit} → ${proposal.proposed_limit} ` +
    `(measured ${proposal.measurement}; ${margin}delta ${
      proposal.delta >= 0 ? "+" : ""
    }${proposal.delta})`;
}
