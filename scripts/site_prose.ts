/** Measure the public marketing corpus for its Vale-density Standard. */

import { dirname, fromFileUrl } from "@std/path";
import { stageSiteProse } from "./site_prose_lib.ts";
import { runVale } from "./vale_lib.ts";

interface ValeAlert {
  Severity: string;
}

const repoRoot = dirname(dirname(fromFileUrl(import.meta.url)));
const stage = await stageSiteProse(repoRoot);
try {
  const run = await runVale(repoRoot, ["--output=JSON", stage.dir]);
  const stdout = new TextDecoder().decode(run.stdout);
  let report: Record<string, ValeAlert[]>;
  try {
    report = JSON.parse(stdout) as Record<string, ValeAlert[]>;
  } catch {
    console.error(new TextDecoder().decode(run.stderr));
    throw new Error(
      "vale did not emit parseable JSON — is it installed and has `vale sync` run?",
    );
  }

  let errors = 0;
  let warnings = 0;
  let suggestions = 0;
  for (const alerts of Object.values(report)) {
    for (const alert of alerts) {
      if (alert.Severity === "error") errors++;
      else if (alert.Severity === "warning") warnings++;
      else if (alert.Severity === "suggestion") suggestions++;
    }
  }
  const total = errors + warnings + suggestions;
  console.error(
    `public site prose: ${total} alerts across ${stage.words} words ` +
      `(${errors} error, ${warnings} warning, ${suggestions} suggestion)`,
  );
  console.log(`DISCERN_METRIC site_prose ${total}`);
  console.log(`DISCERN_METRIC site_prose_words ${stage.words}`);
} finally {
  await Deno.remove(stage.dir, { recursive: true }).catch(() => {});
}
