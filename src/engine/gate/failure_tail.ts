/**
 * The human failure tail shared by the gate verbs — finish, prepare, test. A failed
 * gate ends here, and the order is deliberate: the withheld command output (quieted
 * presentations only — see {@link renderFailureTail}), the stage headline, then the
 * gotchas pointer, then the structured per-tool recap, then a one-line summary (the
 * BLUF) — the actionable recap LAST so a reader who keeps only the end of the stream
 * (`… | tail`) still sees what failed and how to re-run it, not a generic pointer.
 * The recap and the BLUF are two renderings of the SAME `diagnostics[]` the `--json`
 * envelope carries — one source, never a second.
 */

import type { Diagnostic } from "../../shared/result.ts";
import type { Out } from "../output.ts";
import { type GotchasFailureTail, renderGotchasTail } from "./gotchas.ts";

const GATE_FAILURE_HELP_COMMAND =
  "discern docs 20-quality-gate/when-the-gate-fails";

/**
 * The captured output a quieted run withheld: one bannered section per diagnostic
 * that carries output, mirroring what the narrated runner would have printed after
 * each failed command. Rendered FIRST, so the tail keeps its shape — output above,
 * scannable recap and BLUF below — and a `… | tail` still lands on the summary.
 * When the inline view was truncated to the capture cap, the full-capture path
 * follows the excerpt.
 */
function renderWithheldOutput(out: Out, diagnostics: Diagnostic[]): void {
  const c = out.c;
  for (const d of diagnostics) {
    if (d.output === undefined || d.output.trim() === "") {
      continue;
    }
    out.group(`withheld-output:${d.tool}`);
    out.raw(`${c.dim}── ${d.tool} ─${c.reset} ${c.red}output${c.reset}\n`);
    out.raw(d.output.endsWith("\n") ? d.output : `${d.output}\n`);
    if (d.truncated === true && d.output_path !== undefined) {
      out.raw(`${c.dim}full output: ${d.output_path}${c.reset}\n`);
    }
  }
}

/**
 * The scannable per-tool failures block: each failed tool, its Tier-1 location when
 * parsed, and the exact command to reproduce it in isolation. The full tool output
 * already appeared above — streamed by a narrated run, or led with by this tail when
 * the run was quieted — so this is the "what to fix and how to re-run it" summary,
 * the human mirror of the `diagnostics[]` an agent reads from `--json`.
 */
function renderFailures(out: Out, diagnostics: Diagnostic[]): void {
  if (diagnostics.length === 0) {
    return;
  }
  const c = out.c;
  out.heading(`Failures (${diagnostics.length})`);
  for (const d of diagnostics) {
    const loc = d.file !== undefined
      ? ` ${c.dim}${d.file}${
        d.line !== undefined ? `:${d.line}` : ""
      }${c.reset}`
      : "";
    out.raw(
      `  ${c.red}✗${c.reset} ${d.tool}${loc} ${c.dim}—${c.reset} ${d.message}\n`,
    );
    out.raw(`    ${c.dim}reproduce:${c.reset} ${d.reproduce_cmd}\n`);
  }
}

/**
 * The tail-safe summary line — the LAST thing a failed verb prints, so a reader who
 * keeps only the end of the stream (`… | tail`) still sees what failed and how to
 * re-run it. Its reproduce commands are the de-duplicated `reproduce_cmd`s of the SAME
 * diagnostics. With no diagnostics (only finish's merge check) it falls back to the
 * headline. Written to stdout — the recap's stream — so it survives `2>/dev/null` and
 * lands last in a merged stream.
 */
function renderFailBluf(
  out: Out,
  verb: string,
  headline: string,
  diagnostics: Diagnostic[],
): void {
  const c = out.c;
  if (diagnostics.length === 0) {
    out.raw(
      `${c.red}✗${c.reset} discern ${verb} failed: ${headline}\n`,
    );
    return;
  }
  const cmds = [...new Set(diagnostics.map((d) => d.reproduce_cmd))];
  const shown = cmds.slice(0, 3).join(" ; ");
  const more = cmds.length > 3 ? ` ; +${cmds.length - 3} more` : "";
  const n = diagnostics.length;
  out.raw(
    `${c.red}✗${c.reset} discern ${verb} failed — ${n} problem${
      n === 1 ? "" : "s"
    }; reproduce: ${shown}${more}\n`,
  );
}

/**
 * Print the shared human failure tail for a gate verb: the withheld output (when the
 * presentation quieted the runner), the headline (the verb/stage message), the
 * gotchas section (the inlined matched trap, or the pointer, plus any
 * malformed-matcher warnings — the SAME fired hints the envelope carries), the
 * structured recap, and the tail-safe BLUF. The one place finish/prepare/test render
 * a failure, so the three stay consistent and a `… | tail` of any of them lands on
 * actionable signal.
 *
 * `outputWithheld` is required, not defaulted: every verb must say which
 * presentation it ran. A narrated run streams each failed command's output through
 * the job runner before this tail — pass false, or the output prints twice. The
 * compact live-table presentation quiets that runner, leaving the captured output
 * reachable only through `--json` — pass true, or a human at a terminal sees
 * "failed (exit 1)" and nothing else.
 */
export function renderFailureTail(out: Out, opts: {
  verb: string;
  headline: string;
  diagnostics: Diagnostic[];
  gotchas: GotchasFailureTail | undefined;
  outputWithheld: boolean;
}): void {
  const { verb, headline, diagnostics, gotchas, outputWithheld } = opts;
  if (outputWithheld) {
    renderWithheldOutput(out, diagnostics);
  }
  out.error(`discern ${verb} failed: ${headline}`);
  out.group("failure-guide");
  out.info(`Failure guide: \`${GATE_FAILURE_HELP_COMMAND}\`.`);
  renderGotchasTail(gotchas, out.color);
  renderFailures(out, diagnostics);
  renderFailBluf(out, verb, headline, diagnostics);
}
