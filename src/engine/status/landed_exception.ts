/** The trunk tip's emergency landing as status reports it. */
import type { StatusData } from "../../shared/result_schemas.ts";
import type { LandedProofReading } from "../gate/proof_notes.ts";

/**
 * The exception reading with whether a later complete run has settled the
 * checks it skipped: outstanding while its landing still appears among the
 * unresolved emergency validations, resolved otherwise.
 */
export function landedExceptionStatus(
  reading: Extract<LandedProofReading, { status: "exception" }>,
  outstanding: readonly { readonly landing_id: string }[],
): NonNullable<StatusData["landed_exception"]> {
  const { status: _status, ...exception } = reading;
  return {
    ...exception,
    validation:
      outstanding.some((row) => row.landing_id === exception.landing_id)
        ? "outstanding"
        : "resolved",
  };
}

/** The one sentence a person reads about an emergency-landed trunk tip. */
export function landedExceptionSentence(
  exception: NonNullable<StatusData["landed_exception"]>,
): string {
  const outstanding = exception.validation === "outstanding";
  return `The trunk tip landed as an emergency with no passing Proof: ${exception.reason}. ${
    outstanding
      ? `Its ${
        exception.exceptions === 1 ? "skipped check is" : "skipped checks are"
      } still outstanding; run discern done --rerun on the trunk.`
      : "A later complete run settled its skipped checks; the emergency record stays in the history."
  }`;
}
