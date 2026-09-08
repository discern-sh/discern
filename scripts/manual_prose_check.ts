/**
 * Block product-manual prose defects with exact source locations. Add --review
 * to display all findings, including editorial advice, without changing the
 * shared gate and Canon Editor verdict. --sarif selects structured output.
 */

import { dirname, fromFileUrl } from "@std/path";
import { valeAlertCount, valeJsonToSarif } from "./prose_lib.ts";
import { checkManualProse } from "./manual_prose_lib.ts";

const repoRoot = dirname(dirname(fromFileUrl(import.meta.url)));
const sarif = Deno.args.includes("--sarif");
const review = Deno.args.includes("--review");
const sourceArgs = Deno.args.filter((arg) =>
  arg !== "--sarif" && arg !== "--review"
);
let result: Awaited<ReturnType<typeof checkManualProse>>;
try {
  result = await checkManualProse(
    repoRoot,
    sourceArgs.length === 0 ? undefined : sourceArgs,
  );
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  Deno.exit(2);
}
if (result.issue !== undefined) {
  if (result.raw !== "") console.log(result.raw.trimEnd());
  if (result.stderr !== "") console.error(result.stderr.trimEnd());
  console.error(result.issue);
} else {
  const findings = review ? result.reviewAlerts : result.alerts;
  if (sarif) {
    console.log(JSON.stringify(valeJsonToSarif(findings, (path) => path)));
  } else if (valeAlertCount(findings) > 0) {
    console.log(JSON.stringify(findings, null, 2));
  }
}
Deno.exit(result.code);
