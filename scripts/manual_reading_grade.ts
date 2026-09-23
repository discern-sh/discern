/**
 * Emit the manual's purpose-scoped deterministic reading-complexity metric.
 * `--pages` first lists each measured page's grade, hardest first.
 */

import { dirname, fromFileUrl } from "@std/path";
import {
  manualReadingGrade,
  manualReadingGradesByPage,
  projectManualProse,
} from "./manual_prose_lib.ts";

const repoRoot = dirname(dirname(fromFileUrl(import.meta.url)));
const pages = await projectManualProse(repoRoot);
if (Deno.args.includes("--pages")) {
  for (const { grade, kind, words, path } of manualReadingGradesByPage(pages)) {
    console.log(
      `${grade.toFixed(2).padStart(6)}  ${kind.padEnd(15)}${
        String(words).padStart(6)
      } words  ${path}`,
    );
  }
}
console.log(
  `DISCERN_METRIC manual_reading_grade ${manualReadingGrade(pages)}`,
);
