/** Package-backed human failure tail shared by done, prepare, and test. */

import type { Diagnostic, FailedStage } from "../../shared/result.ts";
import type { Out } from "../output.ts";
import {
  renderGateDiagnosticOutputs,
  renderGateDiagnostics,
  renderGateFailureSummary,
} from "./presentation.ts";
import { type GotchasFailureTail, renderGotchasTail } from "./gotchas.ts";

const GATE_FAILURE_HELP_COMMAND = "discern docs guide-fix-a-red-gate";

/** Project one output sink into explicit pure-view inputs. */
function presentation(out: Out): {
  readonly terminal: Out["terminal"];
  readonly width: number;
} {
  return { terminal: out.terminal, width: out.terminal.size.columns };
}

/** Remove captured output when the runner already streamed the project bytes. */
function findingOnly(diagnostic: Diagnostic): Diagnostic {
  const copy: Diagnostic = { ...diagnostic };
  delete copy.output;
  delete copy.output_path;
  delete copy.truncated;
  return copy;
}

/**
 * Print one failure journey. Quiet live-table runs first recover their captured
 * excerpts; every run then names the failed state, its guide, normalized
 * findings, and a final Result summary carrying the reproduction command.
 */
export function renderFailureTail(out: Out, opts: {
  verb: string;
  headline: string;
  diagnostics: Diagnostic[];
  failedStage?: FailedStage;
  gotchas: GotchasFailureTail | undefined;
  outputWithheld: boolean;
}): void {
  const {
    verb,
    headline,
    diagnostics,
    failedStage,
    gotchas,
    outputWithheld,
  } = opts;
  const view = presentation(out);
  if (outputWithheld) {
    const captured = renderGateDiagnosticOutputs(diagnostics, view);
    if (captured !== "") {
      out.group("withheld-output");
      out.raw(`${captured}\n`);
    }
  }
  out.error(`discern ${verb} failed: ${headline}`);
  out.group("failure-guide");
  out.info(`Failure guide: \`${GATE_FAILURE_HELP_COMMAND}\`.`);
  renderGotchasTail(gotchas, out.color);
  const findings = renderGateDiagnostics(
    diagnostics.map(findingOnly),
    view,
  );
  if (findings !== "") {
    out.group("failures", `Failures (${diagnostics.length})`);
    out.raw(`${findings}\n`);
  }
  out.group("failure-summary");
  out.raw(
    `${
      renderGateFailureSummary(
        verb,
        headline,
        diagnostics,
        view,
        failedStage,
      )
    }\n`,
  );
}
