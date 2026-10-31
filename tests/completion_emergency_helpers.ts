/** Decoding helpers the emergency suites share: the exact boundary sentence and
 * the accept envelope's emergency payload. */

import { assert } from "@std/assert";
import { type CliRun, decodeCliResult } from "./decode_cli_result.ts";

/** The exact scope sentence every emergency surface repeats verbatim. */
export const BOUNDARY =
  "This authorizes only the displayed local emergency integration. No passing Proof, ordinary grant, remote push, deployment, or change to external branch protections is implied.";

/** Decode the accept envelope's emergency payload, requiring its presence. */
export function emergencyData(
  run: CliRun,
): NonNullable<
  Extract<
    NonNullable<ReturnType<typeof decodeCliResult<"accept">>["data"]>,
    { emergency?: unknown }
  >["emergency"]
> {
  const envelope = decodeCliResult(run, "accept");
  assert(
    envelope.data !== undefined && "emergency" in envelope.data,
    run.stdout,
  );
  const emergency = envelope.data.emergency;
  assert(emergency !== undefined, run.stdout);
  return emergency;
}
