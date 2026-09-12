/**
 * Setup's account of complete validation: what the configured standards read
 * and whose evidence is reused across commits. The engine derives the facts
 * from the same authorities doctor uses; this module owns the shape and the
 * plain sentences that setup's completion result, relay message, and Markdown
 * all speak from.
 */

/** Which standards read a producer they did not run themselves. */
export interface SharedProducerAssurance {
  producer: string;
  standards: string[];
}

export interface CompletionAssurance {
  /** Configured standard names. */
  standards: string[];
  shared: SharedProducerAssurance[];
  /** Producer labels with no declared input closure. */
  candidate_bound: string[];
  /** Producer labels whose evidence is reused when their declared inputs are unchanged. */
  declared: string[];
}

/** Plain sentences: what the standards read and what is reused. */
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
  return [standards, ...(reuse === "" ? [] : [reuse])];
}
