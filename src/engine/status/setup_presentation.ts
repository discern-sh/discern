/** Pure status presentation for incomplete and unproven setup states. */

import { renderDiagnosticCli } from "discern-design-system/cli";
import type { TerminalContext } from "../../lib/terminal.ts";
import { terminalLine, terminalMultiline } from "../../lib/terminal.ts";
import { notApplicableCountLabel } from "../../shared/setup_assurance.ts";
import type { StatusData } from "../../shared/result_schemas.ts";

/** Render the one setup attention block, when status has one to show. */
export function renderSetupStatus(
  data: StatusData,
  width: number,
  context: TerminalContext,
): string[] {
  const setup = data.setup_unfinished;
  if (setup === undefined) {
    if (data.setup_completion !== "unproven") return [];
    return [context.presenter.present(renderDiagnosticCli, {
      title: terminalLine("Setup completion is unproven"),
      impact: terminalLine(
        "The completion event was recorded without Gate Proof and cannot be accepted or activated.",
      ),
      correction: terminalMultiline(
        "Resolve the incomplete or red setup, commit the correction, then run `discern setup done`.",
      ),
      severity: "attention",
      maxWidth: width,
    })];
  }
  const wired = setup.known_jobs.filter((job) => job.wired).map((job) =>
    job.name
  );
  const notApplicable = setup.known_jobs.filter((job) =>
    job.not_applicable === true
  ).map((job) => job.name);
  const missing = setup.known_jobs.filter((job) =>
    !job.wired && job.not_applicable !== true
  ).map((job) => job.name);
  const impact = [
    ...(setup.pending_markers.length === 0
      ? []
      : [`Skeleton markers: ${setup.pending_markers.join(", ")}.`]),
    `Gate jobs: ${wired.length === 0 ? "none configured" : wired.join(", ")}${
      notApplicable.length === 0
        ? ""
        : `; does not apply: ${notApplicable.join(", ")}`
    }${missing.length === 0 ? "" : `; still unset: ${missing.join(", ")}`}.`,
    `Applicable protections: ${setup.assurance?.enforced ?? 0} of ${
      setup.assurance?.total ?? 0
    } enforced; ${
      notApplicableCountLabel(setup.assurance?.not_applicable ?? 0)
    }.`,
  ].join(" ");
  return [context.presenter.present(renderDiagnosticCli, {
    title: terminalLine("Setup is not finished"),
    impact: terminalLine(impact),
    correction: terminalMultiline(
      "Complete the setup brief before starting or landing work.",
    ),
    severity: "attention",
    maxWidth: width,
  })];
}
