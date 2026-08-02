import { capText } from "../../shared/result.ts";
import { makeTempArtifact } from "../../shared/temp_artifacts.ts";

export interface DiagnosticOutputFields {
  output: string;
  truncated?: true;
  output_path?: string;
}

/** Write the full output. */
async function writeFullOutput(fullText: string): Promise<string | undefined> {
  try {
    const path = await makeTempArtifact("diag");
    await Deno.writeTextFile(path, fullText);
    return path;
  } catch {
    return undefined;
  }
}

/**
 * Prepare captured output for a Tier-0 diagnostic: normalize + cap inline, and
 * best-effort offload the full normalized capture when the inline view is truncated.
 */
export async function diagnosticOutputFields(
  rawOutput: string,
): Promise<DiagnosticOutputFields> {
  const capped = capText(rawOutput);
  const fields: DiagnosticOutputFields = { output: capped.text };
  if (capped.truncated) {
    fields.truncated = true;
    const path = await writeFullOutput(capped.fullText);
    if (path !== undefined) {
      fields.output_path = path;
    }
  }
  return fields;
}
