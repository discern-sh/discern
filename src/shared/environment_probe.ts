/**
 * The setup environment probe's public summary: which required contexts proved
 * their declared return procedure, which have no declaration, and which declare
 * an isolated environment setup does not rehearse. Setup's completion result,
 * its relay message, and its Markdown projection all speak from this one
 * shape; the engine module that runs the probe fills it in.
 */

/** Which required contexts were proven, lack a declaration, or declare isolation. */
export interface EnvironmentProbeSummary {
  readonly proven: readonly string[];
  readonly undeclared: readonly string[];
  readonly isolated: readonly string[];
}

/** Join context names for prose. */
function contexts(names: readonly string[]): string {
  return names.map((context) => `\`${context}\``).join(", ");
}

/** One sentence for people: what the probe established, or why nothing was probed. */
export function describeEnvironmentProbe(
  report: EnvironmentProbeSummary,
): string {
  const notes = [
    report.undeclared.length === 0 || report.proven.length === 0
      ? undefined
      : `No declaration exists for ${
        contexts(report.undeclared)
      }; that context validates in order.`,
    report.isolated.length === 0
      ? undefined
      : `The environment declared for ${
        contexts(report.isolated)
      } is isolated, which setup does not rehearse; efforts in that context validate in order until a separate copy is provided for it.`,
  ].filter((note): note is string => note !== undefined);
  if (report.proven.length === 0) {
    return [
      report.isolated.length === 0
        ? "No execution environment is declared, so efforts validate and land in order; nothing is validated early."
        : "No borrowed execution environment is declared, so efforts validate and land in order.",
      ...notes,
    ].join(" ");
  }
  return [
    `The declared environment for ${
      contexts(report.proven)
    } returned a throwaway copy to its exact source after a passing, a failing, and a cancelled validation, so early validation can use a released checkout.`,
    ...notes,
  ].join(" ");
}
