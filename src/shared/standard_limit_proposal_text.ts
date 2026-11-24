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

/** A figure read from an untyped result record, or nothing when it is absent. */
function figure(
  record: Record<string, unknown> | undefined,
  key: keyof StandardLimitProposalFigures,
): number | undefined {
  const value = record?.[key];
  return typeof value === "number" ? value : undefined;
}

/**
 * The same rendering for a proposal read back from a result envelope, where
 * no schema has typed the record. A record missing a figure names the move
 * alone and guesses nothing.
 */
export function standardLimitProposalRecordFigures(
  record: Record<string, unknown> | undefined,
): string {
  const trunkLimit = figure(record, "trunk_limit");
  const proposedLimit = figure(record, "proposed_limit");
  const measurement = figure(record, "measurement");
  const delta = figure(record, "delta");
  if (
    trunkLimit === undefined || proposedLimit === undefined ||
    measurement === undefined || delta === undefined
  ) {
    return `${trunkLimit ?? "unknown"} → ${proposedLimit ?? "unknown"}`;
  }
  return standardLimitProposalFigures({
    trunk_limit: trunkLimit,
    proposed_limit: proposedLimit,
    measurement,
    margin: figure(record, "margin"),
    delta,
  });
}
