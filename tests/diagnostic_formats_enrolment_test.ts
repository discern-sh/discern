/**
 * Enrolment guard for the diagnostic-format registry. Runtime setup and
 * improvement instructions derive their format list from the registry; the public
 * quickstart remains authored prose, so this guard makes a new parser fail until
 * that page teaches it too.
 */

import { assert, assertEquals, assertStringIncludes } from "@std/assert";
import { dirname, fromFileUrl, join } from "@std/path";
import {
  DIAGNOSTIC_FORMATS,
  diagnosticFormatList,
} from "../src/engine/gate/diagnostics.ts";
import { CATEGORIES } from "../src/engine/improve/rules.ts";

const ROOT = dirname(dirname(fromFileUrl(import.meta.url)));

Deno.test("diagnostic formats enrol setup, improvement, and public instructions", async () => {
  const ids = DIAGNOSTIC_FORMATS.map((format) => format.id);
  const labels = DIAGNOSTIC_FORMATS.map((format) => format.label);
  assertEquals(
    new Set(ids).size,
    ids.length,
    "diagnostic format ids must be unique",
  );
  assertEquals(
    new Set(labels).size,
    labels.length,
    "diagnostic format labels must be unique",
  );

  const setup = await Deno.readTextFile(
    join(ROOT, "templates/setup/instructions.md"),
  );
  assertStringIncludes(
    setup,
    "{{diagnostic_formats}}",
    "setup must derive its supported-format wording from DIAGNOSTIC_FORMATS",
  );

  const gate = CATEGORIES.find((category) => category.name === "gate");
  const review = gate?.rules.find((rule) =>
    rule.id === "gate.structured-diagnostics"
  );
  assert(
    review?.kind === "subjective",
    "the gate category must teach structured diagnostic output",
  );
  assertStringIncludes(
    review.ask,
    diagnosticFormatList(),
    "the improvement review must derive its format list from DIAGNOSTIC_FORMATS",
  );

  const quickstart = await Deno.readTextFile(
    join(ROOT, "project/map/10-getting-started/quickstart.md"),
  );
  assertStringIncludes(
    quickstart,
    `emit ${diagnosticFormatList("or")} to captured`,
    "public setup instructions must list every supported diagnostic format",
  );
});
