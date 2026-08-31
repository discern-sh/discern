/** Block product-manual voice errors with exact source paths and line numbers. */

import { dirname, fromFileUrl } from "@std/path";
import { valeAlertCount, valeJsonToSarif } from "./prose_lib.ts";
import { checkManualProse } from "./manual_prose_lib.ts";

const repoRoot = dirname(dirname(fromFileUrl(import.meta.url)));
const sarif = Deno.args.includes("--sarif");
const sourceArgs = Deno.args.filter((arg) => arg !== "--sarif");
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
} else if (sarif) {
  console.log(JSON.stringify(valeJsonToSarif(result.alerts, (path) => path)));
} else if (valeAlertCount(result.alerts) > 0) {
  console.log(JSON.stringify(result.alerts, null, 2));
}
Deno.exit(result.code);
