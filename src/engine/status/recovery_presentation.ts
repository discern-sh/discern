/** Pure degraded-state projection shared by status classification and guidance. */

import type { StatusFleetEntry } from "../../shared/result_schemas.ts";

export type DegradedFleetKind =
  | "broken"
  | "setup-incomplete"
  | "unreadable";

/** Classify only the degraded states that pre-empt ordinary task status. */
export function degradedFleetKind(
  entry: StatusFleetEntry,
): DegradedFleetKind | undefined {
  if (entry.broken === true) return "broken";
  if (entry.git_unavailable === true) return "unreadable";
  return entry.setup?.state === "incomplete" ||
      entry.setup?.state === "unavailable"
    ? "setup-incomplete"
    : undefined;
}

/** Safe first action for each degraded state. */
export function degradedFleetAttention(
  kind: string,
): string | undefined {
  switch (kind) {
    case "broken":
      return "Setup did not produce a readable project configuration. Choose Show recovery steps in `discern desk`.";
    case "setup-incomplete":
      return "Setup did not reach its ready marker. Choose Show recovery steps in `discern desk`.";
    case "unreadable":
      return "Git could not read this checkout. Choose Show recovery steps in `discern desk`.";
    default:
      return undefined;
  }
}
