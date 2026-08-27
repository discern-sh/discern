/** Block product-manual voice errors with exact source paths and line numbers. */

import { dirname, fromFileUrl } from "@std/path";
import {
  decodeValeReport,
  selectProseGateAlerts,
  valeAlertCount,
  valeJsonToSarif,
} from "./prose_lib.ts";
import {
  manualProseSource,
  withStagedManualProse,
} from "./manual_prose_lib.ts";
import { runVale } from "./vale_lib.ts";

const repoRoot = dirname(dirname(fromFileUrl(import.meta.url)));
const sarif = Deno.args.includes("--sarif");
const code = await withStagedManualProse(repoRoot, async (stage) => {
  const run = await runVale(repoRoot, [
    "--minAlertLevel",
    "suggestion",
    "--output=JSON",
    stage.dir,
  ]);
  const decoder = new TextDecoder();
  const raw = decoder.decode(run.stdout);
  let parsed: ReturnType<typeof decodeValeReport>;
  try {
    parsed = decodeValeReport(raw, "Vale output for the manual prose gate");
  } catch (error) {
    if (raw !== "") console.log(raw.trimEnd());
    const stderr = decoder.decode(run.stderr);
    if (stderr !== "") console.error(stderr.trimEnd());
    console.error(error instanceof Error ? error.message : String(error));
    return run.code === 0 ? 1 : run.code;
  }
  const selected = selectProseGateAlerts(parsed);
  const mapped: Record<string, unknown[]> = {};
  for (const [path, alerts] of Object.entries(selected)) {
    const source = manualProseSource(path, stage);
    mapped[source] ??= [];
    mapped[source].push(...alerts);
  }
  if (sarif) {
    console.log(JSON.stringify(valeJsonToSarif(mapped, (path) => path)));
  } else if (valeAlertCount(mapped) > 0) {
    console.log(JSON.stringify(mapped, null, 2));
  }
  const rawHasAlerts = Object.values(parsed).some((alerts) =>
    alerts.length > 0
  );
  return run.code !== 0 && !rawHasAlerts
    ? run.code
    : valeAlertCount(mapped) > 0
    ? 1
    : 0;
});
Deno.exit(code);
