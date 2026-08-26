/** Focused proof that the promise-effect detector uses resolved TypeScript types. */

import { assertEquals } from "@std/assert";
import { join } from "@std/path";
import {
  createPromiseEffectsProject,
  promiseEffectFindingsInFiles,
} from "../scripts/promise_effects.ts";
import { REPO_ROOT } from "./repo_authored_paths.ts";

const FIXTURE_ROOT = join(REPO_ROOT, "tests", "fixtures", "promise_effects");

Deno.test("the actual Deno project resolves imported and generic promise-like expressions", async () => {
  const project = await createPromiseEffectsProject();
  const imported = project.addSourceFileAtPath(
    join(FIXTURE_ROOT, "imported.ts"),
  );
  const consumer = project.addSourceFileAtPath(
    join(FIXTURE_ROOT, "consumer.ts"),
  );
  project.resolveSourceFileDependencies();

  const options = project.getCompilerOptions();
  assertEquals(options.strict, true);
  assertEquals(options.noUncheckedIndexedAccess, true);
  assertEquals(options.exactOptionalPropertyTypes, true);

  const findings = promiseEffectFindingsInFiles(
    [imported, consumer],
  );
  assertEquals(
    findings.map((finding) => [
      finding.expression,
      finding.reason,
    ]),
    [
      ["promisedEffect()", "ignored-promise"],
      ["thenableEffect()", "ignored-promise"],
      ["unionEffect()", "ignored-promise"],
      ['overloadedEffect("async")', "ignored-promise"],
      ["genericEffect(Promise.resolve(1))", "ignored-promise"],
      ['ensureDir("fixture")', "ignored-promise"],
      ["void promisedEffect()", "naked-void"],
    ],
  );
});
