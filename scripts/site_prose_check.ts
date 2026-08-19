/** Block public marketing prose on Vale errors; Standards hold every advisory. */

import { dirname, fromFileUrl } from "@std/path";
import {
  selectProseGateAlerts,
  valeAlertCount,
  valeJsonToSarif,
} from "./prose_lib.ts";
import {
  siteProseSource,
  type StagedSiteProse,
  stageSiteProse,
} from "./site_prose_lib.ts";
import { runVale } from "./vale_lib.ts";

/** Select error-severity alerts without weakening optional custom-zero mode. */
function selectValeErrors(report: unknown): Record<string, unknown[]> {
  const selected: Record<string, unknown[]> = {};
  if (report === null || typeof report !== "object" || Array.isArray(report)) {
    return selected;
  }
  for (const [path, alerts] of Object.entries(report)) {
    if (!Array.isArray(alerts)) continue;
    const errors = alerts.filter((alert) =>
      alert !== null && typeof alert === "object" &&
      (alert as Record<string, unknown>).Severity === "error"
    );
    if (errors.length > 0) selected[path] = errors;
  }
  return selected;
}

/** Replace staged paths and discard projection-only line coordinates. */
function authoredAlerts(
  report: Record<string, unknown[]>,
  stage: StagedSiteProse,
): Record<string, unknown[]> {
  const mapped: Record<string, unknown[]> = {};
  for (const [path, alerts] of Object.entries(report)) {
    const source = siteProseSource(path, stage);
    mapped[source] ??= [];
    mapped[source].push(...alerts.map((alert) => {
      if (alert === null || typeof alert !== "object") return alert;
      const fields = { ...(alert as Record<string, unknown>) };
      delete fields.Line;
      delete fields.Span;
      return fields;
    }));
  }
  return mapped;
}

const repoRoot = dirname(dirname(fromFileUrl(import.meta.url)));
const sarif = Deno.args.includes("--sarif");
const customZero = Deno.args.includes("--custom-zero");
const stage = await stageSiteProse(repoRoot);
let code = 1;
try {
  const run = await runVale(repoRoot, [
    "--minAlertLevel",
    customZero ? "suggestion" : "error",
    "--output=JSON",
    stage.dir,
  ]);
  const decoder = new TextDecoder();
  const raw = decoder.decode(run.stdout);
  let parsed: unknown;
  let parsedOk = false;
  try {
    parsed = JSON.parse(raw);
    parsedOk = true;
  } catch {
    if (raw !== "") console.log(raw.trimEnd());
    const stderr = decoder.decode(run.stderr);
    if (stderr !== "") console.error(stderr.trimEnd());
    code = run.code;
  }

  if (parsedOk) {
    const selected = customZero
      ? selectProseGateAlerts(parsed)
      : selectValeErrors(parsed);
    const mapped = authoredAlerts(selected, stage);
    if (sarif) {
      console.log(JSON.stringify(valeJsonToSarif(mapped, (path) => path)));
    } else if (valeAlertCount(mapped) > 0) {
      console.log(JSON.stringify(mapped, null, 2));
    }
    const rawHasAlerts = Object.values(
      parsed as Record<string, unknown>,
    ).some((value) => Array.isArray(value) && value.length > 0);
    code = run.code !== 0 && !rawHasAlerts
      ? run.code
      : valeAlertCount(mapped) > 0
      ? 1
      : 0;
  }
} finally {
  await Deno.remove(stage.dir, { recursive: true }).catch(() => {});
}
Deno.exit(code);
