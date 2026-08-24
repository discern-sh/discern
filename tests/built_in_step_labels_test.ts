/**
 * Class guard for built-in plan-step labels. Every static discern-owned label
 * comes from one kebab-case registry; project-owned identifiers stay dynamic.
 */

import { assertEquals, assertMatch } from "@std/assert";
import { join } from "@std/path";
import builtInStepLabelPlugin from "../scripts/built_in_step_label_lint.ts";
import {
  BUILT_IN_STEP_LABELS,
  type PlanStep,
  verbatimStepLabel,
} from "../src/shared/result.ts";
import { REPO_ROOT } from "./repo_authored_paths.ts";
import { structuralGuardScope } from "./structural_guard_scope.ts";

const RULE_ID = "discern/built-in-step-label-registry";
const KEBAB_CASE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

/** Run the built-in-label structural rule over one in-memory module. */
function diagnostics(
  source: string,
  filename = "synthetic.ts",
): Deno.lint.Diagnostic[] {
  return Deno.lint.runPlugin(builtInStepLabelPlugin, filename, source);
}

/** Convert a diagnostic byte offset to a one-based source line. */
function diagnosticLine(
  source: string,
  diagnostic: Deno.lint.Diagnostic,
): number {
  return source.slice(0, diagnostic.range[0]).split("\n").length;
}

Deno.test("built-in step labels use kebab-case", () => {
  for (const [name, label] of Object.entries(BUILT_IN_STEP_LABELS)) {
    assertMatch(label, KEBAB_CASE, `${name}: ${label}`);
  }
});

Deno.test("built-in step label guard rejects an unrelated future sibling", () => {
  const source = `
const nebula = {
  kind: "git",
  label: "calibrate quasar",
  disposition: "run",
};
const configured = {
  kind: "resource-destroy",
  label: resource.name,
  disposition: "run",
};
const enrolled = {
  kind: "git",
  label: BUILT_IN_STEP_LABELS.calibrateQuasar,
  disposition: "run",
};
`;

  const found = diagnostics(source);
  assertEquals(found.length, 1);
  assertEquals(found[0]?.id, RULE_ID);
  assertEquals(
    found[0]?.message,
    "Static built-in step label 'calibrate quasar' must come from BUILT_IN_STEP_LABELS. Configured identifiers must remain dynamic expressions.",
  );
});

Deno.test("step-label types reject a file-local static alias", () => {
  const localStaticLabel = "calibrate quasar";
  const unregistered: PlanStep = {
    kind: "git",
    // @ts-expect-error Unregistered static labels cannot enter a plan step.
    label: localStaticLabel,
    disposition: "run",
  };
  const configured: PlanStep = {
    kind: "resource-destroy",
    label: verbatimStepLabel("lifecycle_probe"),
    disposition: "run",
  };

  assertEquals(unregistered.label, localStaticLabel);
  assertEquals(configured.label, "lifecycle_probe");
});

Deno.test("authored static step labels come from the built-in registry", async () => {
  const offenders: string[] = [];
  const sources = await structuralGuardScope({
    guard: "tests/built_in_step_labels_test.ts#static-plan-step-labels",
    universe: "authored-ts",
    narrow: {
      reason:
        "Files ending _test.ts construct forbidden controls and cannot emit product results; executable helpers remain enrolled.",
      include: (rel) => !rel.endsWith("_test.ts"),
    },
  });
  for (const rel of sources) {
    const source = await Deno.readTextFile(join(REPO_ROOT, rel));
    for (const diagnostic of diagnostics(source, rel)) {
      offenders.push(
        `${rel}:${diagnosticLine(source, diagnostic)} ${diagnostic.message}`,
      );
    }
  }

  assertEquals(offenders, []);
});
