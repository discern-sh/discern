/**
 * Setup's account of complete validation and coordination: what the configured
 * standards read, whose evidence is reused across commits, and whether efforts
 * validate in order or early. The engine derives the facts from the same
 * authorities doctor uses; this module owns the shape and the plain sentences
 * that setup's completion result, relay message, and Markdown all speak from.
 */

/** Which standards read a producer they did not run themselves. */
export interface SharedProducerAssurance {
  producer: string;
  standards: string[];
}

/** Whether early validation can run, in the derivation's own vocabulary. */
export type SpeculationState =
  | "off"
  | "undeclared"
  | "unproven"
  | "no-slot"
  | "available";

export interface CompletionAssurance {
  /** Configured standard names. */
  standards: string[];
  shared: SharedProducerAssurance[];
  /** Producer labels with no declared input closure. */
  candidate_bound: string[];
  /** Producer labels whose evidence is reused when their declared inputs are unchanged. */
  declared: string[];
  speculation: SpeculationState;
}

/** Plain sentences: what the standards read, what is reused, and how efforts coordinate. */
export function describeCompletionAssurance(
  assurance: CompletionAssurance,
): string[] {
  const list = (items: readonly string[]): string => items.join(", ");
  const standards = assurance.standards.length === 0
    ? "No quality numbers are held yet."
    : `${assurance.standards.length} quality number${
      assurance.standards.length === 1 ? " is" : "s are"
    } held (${list(assurance.standards)})${
      assurance.shared.length === 0
        ? "."
        : `; ${
          assurance.shared.map((entry) =>
            `one run of ${entry.producer} supplies ${list(entry.standards)}`
          ).join("; ")
        }.`
    }`;
  const reuse = [
    assurance.declared.length === 0
      ? undefined
      : `Evidence for ${
        list(assurance.declared)
      } is reused across commits when nothing it reads has changed.`,
    assurance.candidate_bound.length === 0
      ? undefined
      : `Evidence for ${
        list(assurance.candidate_bound)
      } is produced again for every commit because no \`inputs\` are declared.`,
  ].filter((sentence): sentence is string => sentence !== undefined).join(" ");
  const coordination = assurance.speculation === "available"
    ? "Efforts land in order, and an effort may be validated early in a released checkout once the one ahead of it is approved."
    : assurance.speculation === "off"
    ? "Efforts validate and land in order; early validation is off."
    : assurance.speculation === "undeclared"
    ? "Efforts validate and land in order; early validation is requested but no environment is declared, so it does not run."
    : assurance.speculation === "unproven"
    ? "Efforts validate and land in order; early validation is requested but the declared environment has not been proven as it currently stands, so it does not run."
    : "Efforts validate and land in order; early validation is requested but no validation slot is free beyond the one reserved for the next landing, so it does not run.";
  return [standards, ...(reuse === "" ? [] : [reuse]), coordination];
}
