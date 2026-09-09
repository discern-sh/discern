/**
 * The setup environment probe's public summary: which required contexts proved
 * their declared return procedure and which have no declaration. Setup's
 * completion result, its relay message, and its Markdown projection all speak
 * from this one shape; the engine module that runs the probe fills it in.
 */

/** Which required contexts were proven or lack an environment declaration. */
export interface EnvironmentProbeSummary {
  readonly proven: readonly string[];
  readonly undeclared: readonly string[];
}

/** One sentence for people: what the probe established, or why nothing was probed. */
export function describeEnvironmentProbe(
  report: EnvironmentProbeSummary,
): string {
  if (report.proven.length === 0) {
    return "No execution environment is declared, so efforts validate and land in order; nothing is validated early.";
  }
  const contexts = report.proven.map((context) => `\`${context}\``).join(", ");
  return `The declared environment for ${contexts} returned a throwaway copy to its exact source after a passing, a failing, and a cancelled validation, so early validation can use a released checkout.${
    report.undeclared.length === 0
      ? ""
      : ` No declaration exists for ${
        report.undeclared.map((context) => `\`${context}\``).join(", ")
      }; that context validates in order.`
  }`;
}
