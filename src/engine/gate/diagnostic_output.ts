import { capText } from "../../shared/result.ts";
import { bestEffort } from "../../shared/best_effort.ts";
import { makeTempArtifact } from "../../shared/temp_artifacts.ts";
import { tempArtifactScopeFor } from "../temp_artifact_scope.ts";

export interface DiagnosticOutputFields {
  output: string;
  truncated?: true;
  output_path?: string;
}

/** Persist uncapped diagnostic text in the temp-artifact registry when possible. */
async function writeFullOutput(
  root: string,
  fullText: string,
): Promise<string | undefined> {
  let recordedPath: string | undefined;
  await bestEffort("diagnostic-full-output-record", async () => {
    recordedPath = await makeTempArtifact(
      "diag",
      await tempArtifactScopeFor(root),
    );
    await Deno.writeTextFile(recordedPath, fullText);
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
