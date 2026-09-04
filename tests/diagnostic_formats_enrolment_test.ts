/**
 * Enrolment guard for the diagnostic-format registry. Runtime setup and
 * improvement instructions derive their format list from the registry. Reporter
 * internals stay out of the beginner-facing quickstart.
 */

import { assert, assertEquals, assertStringIncludes } from "@std/assert";
import { dirname, fromFileUrl, join } from "@std/path";
import {
  DIAGNOSTIC_FORMATS,
  diagnosticFormatList,
} from "../src/engine/gate/diagnostics.ts";
import { CATEGORIES } from "../src/engine/improve/rules.ts";

const ROOT = dirname(dirname(fromFileUrl(import.meta.url)));

Deno.test("diagnostic formats enrol setup and improvement instructions", async () => {
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
});
