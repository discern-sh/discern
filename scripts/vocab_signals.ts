/**
 * Measure the map's vocabulary debt and emit it as a discern standard metric.
 *
 * This is the measurement command behind `[standards.vocabulary]`. It reads
 * the term registry and the map, counts dead terms (a glossary entry no live
 * page names or links) and redefinitions (a page restating a term bold-faced
 * instead of linking the glossary), and prints the sum as
 * `DISCERN_METRIC vocabulary_debt <count>` — a ceiling that may only fall.
 *
 * Usage: `deno task vocab <map-dir>` (the `[standards.vocabulary]` run
 * command). Prints each finding to stderr for context, then the metric line
 * to stdout.
 */

import { dirname, fromFileUrl } from "@std/path";
import { loadConfig } from "../src/shared/config_schema.ts";
import { resolveMapDir } from "../src/lib/paths.ts";
import { measureVocabSignals } from "./vocab_signals_lib.ts";

const repoRoot = dirname(dirname(fromFileUrl(import.meta.url)));
const mapDir = Deno.args[0] ??
  resolveMapDir(repoRoot, await loadConfig(repoRoot)).abs;

const signals = await measureVocabSignals(mapDir);
for (const term of signals.deadTerms) {
  console.error(
    `dead term: "${term}" — no live page names or links it; use it, or retire the entry`,
  );
}
for (const { file, line, term } of signals.redefinitions) {
  console.error(
    `redefinition: ${file}:${line} restates "${term}" — use the term plainly and link its glossary entry`,
  );
}
console.error(
  `${mapDir} vocabulary debt: ${signals.debt} (${signals.deadTerms.length} dead terms, ${signals.redefinitions.length} redefinitions)`,
);
console.log(`DISCERN_METRIC vocabulary_debt ${signals.debt}`);
