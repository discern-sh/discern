import { capText } from "../../shared/result.ts";
import type { DiscernResult } from "../../shared/result.ts";
import {
  DIAGNOSTIC_SUMMARY_BYTES,
  DIAGNOSTIC_SUMMARY_LIMIT,
} from "../../shared/diagnostic_summary.ts";
import { sha256Hex } from "../../shared/sha256.ts";
import { bestEffort } from "../../shared/best_effort.ts";
import { makeTempArtifact } from "../../shared/temp_artifacts.ts";
import { tempArtifactScopeFor } from "../temp_artifact_scope.ts";
import { captureElided } from "../jobs/command.ts";
import { readTextIfExists } from "../../shared/fs_presence.ts";

export interface DiagnosticOutputFields {
  output: string;
  truncated?: true;
  output_path?: string;
}

/**
 * The text format normalization reads for a failed job: the complete capture
 * artifact once the in-memory window elided bytes, else the window itself. A
 * report larger than the window keeps every failing case this way, not only
 * the cases that landed in its head or tail.
 */
export async function normalizableJobOutput(
  job: {
    readonly output?: string | undefined;
    readonly outputPath?: string | undefined;
  },
): Promise<string | undefined> {
  if (job.output === undefined) return undefined;
  if (job.outputPath === undefined || !captureElided(job.output)) {
    return job.output;
  }
  return await readTextIfExists(job.outputPath) ?? job.output;
}

/** Offload only oversized results. A failed write keeps complete inline evidence. */
export async function retainResultDiagnostics(
  root: string,
  result: DiscernResult,
): Promise<void> {
  const diagnostics = result.diagnostics;
  if (diagnostics === undefined) return;
  const raw = JSON.stringify(diagnostics);
  const bytes = new TextEncoder().encode(raw).length;
  if (
    diagnostics.length <= DIAGNOSTIC_SUMMARY_LIMIT &&
    bytes <= DIAGNOSTIC_SUMMARY_BYTES
  ) return;
  if (result.diagnosticEvidence?.raw === raw) return;
  const path = await writeFullOutput(root, raw);
  if (path !== undefined) {
    result.diagnosticEvidence = {
      raw,
      path,
      bytes,
      digest: await sha256Hex(raw),
    };
  }
}

/** Persist uncapped diagnostic text in the temp-artifact registry when possible. */
async function writeFullOutput(
  root: string,
  fullText: string,
): Promise<string | undefined> {
  let recordedPath: string | undefined;
  await bestEffort("diagnostic-full-output-record", async () => {
    const path = await makeTempArtifact(
      "diag",
      await tempArtifactScopeFor(root),
    );
    await Deno.writeTextFile(path, fullText);
    recordedPath = path;
  });
  return recordedPath;
}

/**
 * Prepare captured output for a Tier-0 diagnostic: normalize + cap inline, and
 * best-effort offload the full normalized capture when the inline view is
 * truncated — labeled for the checkout at `root`.
 */
export async function diagnosticOutputFields(
  root: string,
  rawOutput: string,
): Promise<DiagnosticOutputFields> {
  const capped = capText(rawOutput);
  const fields: DiagnosticOutputFields = { output: capped.text };
  if (capped.truncated) {
    fields.truncated = true;
    const path = await writeFullOutput(root, capped.fullText);
    if (path !== undefined) {
      fields.output_path = path;
    }
  }
  return fields;
}
